//! The recorder: one thread owns both audio sources, drains them every 50 ms,
//! resamples to 16 kHz mono 16-bit, and writes two stems ("mic" = You,
//! "system" = Others) as 5-minute WAV chunks. A 5-minute chunk is about 9.6 MB,
//! under NEAR AI's 25 MB upload limit, and 16 kHz is the rate Whisper uses.
//!
//! It reports levels for the meter and watches for three things going wrong:
//! - a stem that has been exact zeros for 30 seconds, which is how a missing
//!   system-audio permission (or a muted mic) shows up;
//! - the mic stream stopping altogether, with no audio for 10 seconds, as it can
//!   when AirPods switch or a mic is unplugged;
//! - both sides quiet for 2 minutes, when the call has probably ended. That one
//!   only asks; the recorder never stops by itself.
//!
//! Chunks are encrypted as they are written (at_rest::AudioWriter): about one second
//! of audio is held in memory, then sealed and appended. No plaintext audio touches
//! the disk, and a crash loses at most that last second.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use ringbuf::traits::Consumer;
use serde::Serialize;

use crate::at_rest::{AudioWriter, Key};

pub const TARGET_RATE: u32 = 16_000;
pub const CHUNK_SECONDS: u64 = 300;
pub const SILENCE_WARN_SECONDS: u64 = 30;
/// No mic audio at all for this long means the stream has stopped.
pub const MIC_STALL_SECONDS: u64 = 10;
/// Under this RMS a second counts as quiet: about -46 dBFS. Speech at any usual mic
/// gain is well above it; room tone, a fan and a call nobody is speaking on sit below.
/// A noisier room never counts as quiet, so the prompt just doesn't come.
pub const QUIET_RMS: f32 = 0.005;
/// Both sides quiet for this long asks "Call ended?".
pub const CALL_ENDED_SECONDS: u64 = 120;
const TICK: Duration = Duration::from_millis(50);
/// Loudness for the quiet watch is measured over windows this long, so a single
/// key click or tap on the desk doesn't count as the call going on.
const QUIET_WINDOW: Duration = Duration::from_secs(1);

// ---------- pure parts (tested below) ----------

/// Streaming linear resampler to 16 kHz with a short box pre-filter against aliasing.
pub struct Resampler {
    step: f64,
    pos: f64,
    prev: f32,
    taps: usize,
    history: Vec<f32>,
}

impl Resampler {
    pub fn new(from_rate: u32) -> Self {
        let ratio = from_rate as f64 / TARGET_RATE as f64;
        let taps = ratio.round().max(1.0) as usize;
        Self { step: ratio, pos: 0.0, prev: 0.0, taps, history: Vec::with_capacity(taps) }
    }

    fn filtered(&mut self, s: f32) -> f32 {
        if self.taps == 1 {
            return s;
        }
        if self.history.len() == self.taps {
            self.history.remove(0);
        }
        self.history.push(s);
        self.history.iter().sum::<f32>() / self.history.len() as f32
    }

    /// Feeds input samples and appends the 16 kHz output to `out`.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        for &raw in input {
            let s = self.filtered(raw);
            // Emit every output sample that falls between the previous and this input sample.
            while self.pos <= 1.0 {
                out.push(self.prev + (s - self.prev) * self.pos as f32);
                self.pos += self.step;
            }
            self.pos -= 1.0;
            self.prev = s;
        }
    }
}

/// Tracks how long a stem has been exact zeros (digital silence, not a quiet room).
#[derive(Default)]
pub struct SilenceWatch {
    zero_run: u64,
    warned: bool,
}

#[derive(Debug, PartialEq)]
pub enum SilenceChange {
    None,
    Started,
    Ended,
}

/// Moves a watch's flag to `now` and says whether that started or ended it.
fn change(flag: &mut bool, now: bool) -> SilenceChange {
    match (now, *flag) {
        (true, false) => {
            *flag = true;
            SilenceChange::Started
        }
        (false, true) => {
            *flag = false;
            SilenceChange::Ended
        }
        _ => SilenceChange::None,
    }
}

impl SilenceWatch {
    /// `rate` is the rate of `samples`. Returns when the warning starts or ends.
    pub fn feed(&mut self, samples: &[f32], rate: u32) -> SilenceChange {
        for &s in samples {
            if s == 0.0 {
                self.zero_run += 1;
            } else {
                self.zero_run = 0;
            }
        }
        change(&mut self.warned, self.zero_run >= SILENCE_WARN_SECONDS * rate as u64)
    }
}

/// Notices a source that has stopped delivering audio at all: no callbacks, so the
/// ring stays empty. cpal doesn't say when the mic goes away (AirPods switching to
/// another device, a USB mic unplugged); the stream just stops calling back.
#[derive(Default)]
pub struct StallWatch {
    without_audio: Duration,
    warned: bool,
}

impl StallWatch {
    /// `got_audio`: whether any samples arrived in the last `elapsed`.
    pub fn feed(&mut self, got_audio: bool, elapsed: Duration) -> SilenceChange {
        self.without_audio = if got_audio { Duration::ZERO } else { self.without_audio + elapsed };
        change(&mut self.warned, self.without_audio >= Duration::from_secs(MIC_STALL_SECONDS))
    }
}

/// Both sides quiet (under QUIET_RMS) for CALL_ENDED_SECONDS: the call has probably
/// ended. Started asks once; it only asks again after sound returns (Ended) and
/// then two more quiet minutes pass.
#[derive(Default)]
pub struct QuietWatch {
    quiet_for: Duration,
    asked: bool,
}

impl QuietWatch {
    /// `loudest`: the higher RMS of the two stems over the last `elapsed`.
    pub fn feed(&mut self, loudest: f32, elapsed: Duration) -> SilenceChange {
        self.quiet_for = if loudest < QUIET_RMS { self.quiet_for + elapsed } else { Duration::ZERO };
        change(&mut self.asked, self.quiet_for >= Duration::from_secs(CALL_ENDED_SECONDS))
    }
}

pub fn chunk_path(dir: &Path, stem: &str, index: usize) -> PathBuf {
    dir.join(format!("{stem}-{index:03}.wav"))
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

// ---------- stems ----------

struct Stem {
    name: &'static str,
    dir: PathBuf,
    resampler: Resampler,
    source_rate: u32,
    key: Key,
    writer: Option<AudioWriter>,
    silence: SilenceWatch,
    /// Only the mic: the system tap delivers zeros, not nothing, when the call is quiet.
    stall: Option<StallWatch>,
    /// What the interface was last told: zeros or stopped.
    silent: bool,
    raw: Vec<f32>,
    out: Vec<f32>,
    level: f32,
    /// Sum of squares and count of the samples kept since the quiet watch last looked.
    window_energy: f64,
    window_samples: usize,
}

impl Stem {
    fn new(name: &'static str, dir: &Path, source_rate: u32, key: &Key) -> Self {
        Self {
            name,
            dir: dir.to_path_buf(),
            key: key.clone(),
            resampler: Resampler::new(source_rate),
            source_rate,
            writer: None,
            silence: SilenceWatch::default(),
            stall: (name == "mic").then(StallWatch::default),
            silent: false,
            raw: vec![0.0; 16_384],
            out: Vec::with_capacity(8_192),
            level: 0.0,
            window_energy: 0.0,
            window_samples: 0,
        }
    }

    fn stopped(&self) -> bool {
        self.stall.as_ref().is_some_and(|s| s.warned)
    }

    /// RMS of the samples kept since the last call (0 with none), and starts a new window.
    fn take_window_rms(&mut self) -> f32 {
        let rms = if self.window_samples == 0 { 0.0 } else { (self.window_energy / self.window_samples as f64).sqrt() as f32 };
        self.window_energy = 0.0;
        self.window_samples = 0;
        rms
    }

    fn open(&mut self, index: usize) -> Result<()> {
        self.writer = Some(AudioWriter::create(&chunk_path(&self.dir, self.name, index), &self.key, TARGET_RATE).map_err(anyhow::Error::msg)?);
        Ok(())
    }

    fn close(&mut self) -> Result<()> {
        if let Some(w) = self.writer.take() {
            w.finish().map_err(anyhow::Error::msg)?;
        }
        Ok(())
    }

    /// Drains the ring. When `keep` is false (paused) the audio is discarded and the
    /// watches wait. Returns the stem's new silent state when it changes: exact zeros
    /// for 30 s, or (the mic) no audio at all for 10 s.
    fn drain(&mut self, source: &mut ringbuf::HeapCons<f32>, keep: bool, elapsed: Duration) -> Result<Option<bool>> {
        let mut level_samples = 0usize;
        let mut level_sum = 0f32;
        loop {
            let n = source.pop_slice(&mut self.raw);
            if n == 0 {
                break;
            }
            let chunk = &self.raw[..n];
            let r = rms(chunk);
            level_sum += r * r * n as f32;
            level_samples += n;
            if !keep {
                continue;
            }
            self.window_energy += (r * r) as f64 * n as f64;
            self.window_samples += n;
            self.silence.feed(chunk, self.source_rate);
            self.out.clear();
            self.resampler.process(chunk, &mut self.out);
            if let Some(w) = self.writer.as_mut() {
                for &s in &self.out {
                    w.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).map_err(anyhow::Error::msg)?;
                }
            }
        }
        if keep && let Some(stall) = self.stall.as_mut() {
            stall.feed(level_samples > 0, elapsed);
        }
        if level_samples > 0 {
            self.level = (level_sum / level_samples as f32).sqrt();
        } else if self.stopped() {
            // A stopped stream has no last level to hold: the meter goes flat.
            self.level = 0.0;
        }
        let silent = self.silence.warned || self.stopped();
        Ok(match change(&mut self.silent, silent) {
            SilenceChange::None => None,
            _ => Some(silent),
        })
    }
}

// ---------- the recorder thread ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordingInfo {
    pub dir: String,
    pub microphone: String,
    pub system_audio: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordingResult {
    pub dir: String,
    pub chunks: usize,
    pub seconds: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Levels {
    pub mic: f32,
    pub system: f32,
    pub seconds: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SilenceEvent {
    pub stem: &'static str,
    pub silent: bool,
    /// The mic stream stopped delivering audio, rather than delivering zeros.
    pub stopped: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QuietEvent {
    /// Both sides have been quiet for CALL_ENDED_SECONDS (true), or sound came back (false).
    pub quiet: bool,
}

/// What the recorder reports while it runs.
pub trait Events: Send + 'static {
    fn levels(&self, levels: Levels);
    fn silence(&self, event: SilenceEvent);
    fn quiet(&self, event: QuietEvent);
}

enum Command {
    Pause(bool),
    Stop(Sender<Result<RecordingResult, String>>),
}

pub struct Recording {
    commands: Sender<Command>,
}

impl Recording {
    /// Starts both sources on a new thread and waits until they are running.
    /// Chunks are encrypted with `key` (the data key from at_rest).
    pub fn start(dir: PathBuf, key: Key, events: impl Events) -> Result<(Self, RecordingInfo)> {
        fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
        let (commands, inbox) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("recorder".into())
            .spawn(move || run(dir, key, inbox, ready_tx, events))?;
        let info = ready_rx.recv().context("recorder thread ended")?.map_err(anyhow::Error::msg)?;
        Ok((Self { commands }, info))
    }

    pub fn pause(&self, paused: bool) {
        let _ = self.commands.send(Command::Pause(paused));
    }

    pub fn stop(self) -> Result<RecordingResult> {
        let (tx, rx) = mpsc::channel();
        self.commands.send(Command::Stop(tx)).context("recorder thread ended")?;
        rx.recv().context("recorder thread ended")?.map_err(anyhow::Error::msg)
    }
}

fn run(dir: PathBuf, key: Key, inbox: Receiver<Command>, ready: Sender<Result<RecordingInfo, String>>, events: impl Events) {
    // The audio devices are created and dropped on this thread; they are not Send.
    #[cfg(target_os = "macos")]
    let speaker = crate::capture::start_speaker();
    #[cfg(not(target_os = "macos"))]
    let speaker: Result<((), crate::capture::Source)> = Err(anyhow::anyhow!("system audio needs macOS"));

    let (mic_stream, mut mic) = match crate::capture::start_mic() {
        Ok(m) => m,
        Err(e) => {
            let _ = ready.send(Err(format!("Microphone: {e:#}")));
            return;
        }
    };
    let (speaker_guard, mut system) = match speaker {
        Ok((guard, source)) => (Some(guard), Some(source)),
        Err(e) => {
            eprintln!("system audio unavailable: {e:#}");
            (None, None)
        }
    };

    let mut mic_stem = Stem::new("mic", &dir, mic.sample_rate, &key);
    let mut sys_stem = system.as_ref().map(|s| Stem::new("system", &dir, s.sample_rate, &key));
    let mut index = 0;
    let open_all = |index: usize, mic_stem: &mut Stem, sys_stem: &mut Option<Stem>| -> Result<()> {
        mic_stem.open(index)?;
        if let Some(s) = sys_stem.as_mut() {
            s.open(index)?;
        }
        Ok(())
    };
    if let Err(e) = open_all(index, &mut mic_stem, &mut sys_stem) {
        let _ = ready.send(Err(format!("Writing audio: {e:#}")));
        return;
    }
    let _ = ready.send(Ok(RecordingInfo {
        dir: dir.display().to_string(),
        microphone: mic.name.clone(),
        system_audio: system.is_some(),
    }));

    let mut paused = false;
    let mut recorded = Duration::ZERO;
    let mut chunk_recorded = Duration::ZERO;
    let mut quiet = QuietWatch::default();
    let mut quiet_window = Duration::ZERO;
    let mut last = Instant::now();
    let finish = |result: Result<RecordingResult, String>, reply: Sender<Result<RecordingResult, String>>| {
        let _ = reply.send(result);
    };

    loop {
        std::thread::sleep(TICK);
        let elapsed = last.elapsed();
        last = Instant::now();
        if !paused {
            recorded += elapsed;
            chunk_recorded += elapsed;
        }

        let mut drain = || -> Result<()> {
            if let Some(silent) = mic_stem.drain(&mut mic.samples, !paused, elapsed)? {
                events.silence(SilenceEvent { stem: "mic", silent, stopped: mic_stem.stopped() });
            }
            if let (Some(stem), Some(source)) = (sys_stem.as_mut(), system.as_mut())
                && let Some(silent) = stem.drain(&mut source.samples, !paused, elapsed)?
            {
                events.silence(SilenceEvent { stem: "system", silent, stopped: false });
            }
            Ok(())
        };
        if let Err(e) = drain() {
            eprintln!("recorder: {e:#}");
        }
        if !paused {
            quiet_window += elapsed;
            if quiet_window >= QUIET_WINDOW {
                let loudest = mic_stem.take_window_rms().max(sys_stem.as_mut().map_or(0.0, Stem::take_window_rms));
                if let SilenceChange::Started | SilenceChange::Ended = quiet.feed(loudest, quiet_window) {
                    events.quiet(QuietEvent { quiet: quiet.asked });
                }
                quiet_window = Duration::ZERO;
            }
        }
        events.levels(Levels {
            mic: mic_stem.level,
            system: sys_stem.as_ref().map_or(0.0, |s| s.level),
            seconds: recorded.as_secs(),
        });

        if chunk_recorded.as_secs() >= CHUNK_SECONDS {
            let mut rotate = || -> Result<()> {
                mic_stem.close()?;
                if let Some(s) = sys_stem.as_mut() {
                    s.close()?;
                }
                Ok(())
            };
            if rotate().is_ok() {
                index += 1;
                let _ = open_all(index, &mut mic_stem, &mut sys_stem);
            }
            chunk_recorded = Duration::ZERO;
        }

        match inbox.try_recv() {
            Ok(Command::Pause(p)) => paused = p,
            Ok(Command::Stop(reply)) => {
                let closed = mic_stem.close().and_then(|_| sys_stem.as_mut().map_or(Ok(()), |s| s.close()));
                drop(mic_stream);
                drop(speaker_guard);
                let result = closed
                    .map(|_| RecordingResult { dir: dir.display().to_string(), chunks: index + 1, seconds: recorded.as_secs() })
                    .map_err(|e| format!("{e:#}"));
                finish(result, reply);
                return;
            }
            Err(mpsc::TryRecvError::Empty) => {}
            // The app dropped the recording without stopping: close the files and end.
            Err(mpsc::TryRecvError::Disconnected) => {
                let _ = mic_stem.close();
                if let Some(s) = sys_stem.as_mut() {
                    let _ = s.close();
                }
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampler_outputs_16k_from_48k_and_44k1() {
        for rate in [48_000u32, 44_100] {
            let mut r = Resampler::new(rate);
            let mut out = Vec::new();
            let one_second = vec![0.5f32; rate as usize];
            r.process(&one_second, &mut out);
            let n = out.len() as i64;
            assert!((n - TARGET_RATE as i64).abs() <= 2, "{rate} Hz gave {n} samples");
        }
    }

    #[test]
    fn resampler_keeps_a_low_tone() {
        // A 440 Hz tone at 48 kHz should come out at the same frequency and similar level.
        let mut r = Resampler::new(48_000);
        let input: Vec<f32> = (0..48_000).map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / 48_000.0).sin() * 0.5).collect();
        let mut out = Vec::new();
        r.process(&input, &mut out);
        let crossings = out.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count();
        assert!((438..=442).contains(&crossings), "{crossings} upward zero crossings");
        let level = rms(&out[1000..]);
        assert!(level > 0.3, "level {level}");
    }

    #[test]
    fn silence_warns_after_thirty_seconds_of_exact_zeros_and_clears() {
        let mut w = SilenceWatch::default();
        let rate = 1_000;
        let zeros = vec![0.0f32; rate as usize];
        for _ in 0..29 {
            assert!(matches!(w.feed(&zeros, rate), SilenceChange::None));
        }
        assert!(matches!(w.feed(&zeros, rate), SilenceChange::Started));
        assert!(matches!(w.feed(&zeros, rate), SilenceChange::None));
        assert!(matches!(w.feed(&[0.01], rate), SilenceChange::Ended));
    }

    #[test]
    fn quiet_room_is_not_silence() {
        let mut w = SilenceWatch::default();
        let quiet = vec![0.0001f32; 40_000];
        assert!(matches!(w.feed(&quiet, 1_000), SilenceChange::None));
    }

    #[test]
    fn the_mic_stopping_warns_after_ten_seconds_without_audio_and_clears_when_audio_returns() {
        let mut w = StallWatch::default();
        let tick = Duration::from_millis(50);
        // Bursty callbacks are fine: a tick or two without audio is normal.
        for _ in 0..100 {
            assert_eq!(w.feed(false, tick), SilenceChange::None);
            assert_eq!(w.feed(true, tick), SilenceChange::None);
        }
        for _ in 0..199 {
            assert_eq!(w.feed(false, tick), SilenceChange::None);
        }
        assert_eq!(w.feed(false, tick), SilenceChange::Started, "10 s with no audio at all");
        assert_eq!(w.feed(false, tick), SilenceChange::None, "warned once");
        assert_eq!(w.feed(true, tick), SilenceChange::Ended);
    }

    #[test]
    fn two_quiet_minutes_ask_once_and_ask_again_only_after_sound_returns() {
        let mut w = QuietWatch::default();
        let second = Duration::from_secs(1);
        let room = 0.003; // a quiet room, under QUIET_RMS
        let voice = 0.05; // ordinary speech, about -26 dBFS
        for _ in 0..119 {
            assert_eq!(w.feed(room, second), SilenceChange::None);
        }
        // One second of someone talking starts the two minutes again.
        assert_eq!(w.feed(voice, second), SilenceChange::None);
        for _ in 0..119 {
            assert_eq!(w.feed(0.0, second), SilenceChange::None);
        }
        assert_eq!(w.feed(room, second), SilenceChange::Started, "both sides quiet for 2 minutes");
        for _ in 0..600 {
            assert_eq!(w.feed(room, second), SilenceChange::None, "it asks once, however long it stays quiet");
        }
        assert_eq!(w.feed(voice, second), SilenceChange::Ended, "sound came back");
        for _ in 0..119 {
            assert_eq!(w.feed(room, second), SilenceChange::None);
        }
        assert_eq!(w.feed(room, second), SilenceChange::Started, "quiet again for 2 minutes");
    }

    #[test]
    fn a_noisy_room_never_counts_as_quiet() {
        let mut w = QuietWatch::default();
        for _ in 0..600 {
            assert_eq!(w.feed(QUIET_RMS, Duration::from_secs(1)), SilenceChange::None);
        }
    }

    #[test]
    fn the_mic_stem_reports_zeros_and_stopping_and_the_system_stem_never_stalls() {
        use ringbuf::traits::{Producer, Split};
        let dir = std::env::temp_dir();
        let key = crate::at_rest::new_key().unwrap();
        let tick = Duration::from_millis(50);
        let rate = 1_000;
        let (mut prod, mut cons) = ringbuf::HeapRb::<f32>::new(4_000).split();

        // The mic stops calling back: silent and stopped after 10 s, and the meter goes flat.
        let mut mic = Stem::new("mic", &dir, rate, &key);
        prod.push_slice(&[0.3; 50]);
        assert_eq!(mic.drain(&mut cons, true, tick).unwrap(), None);
        assert!(mic.level > 0.2);
        for _ in 0..199 {
            assert_eq!(mic.drain(&mut cons, true, tick).unwrap(), None);
        }
        assert_eq!(mic.drain(&mut cons, true, tick).unwrap(), Some(true));
        assert!(mic.stopped());
        assert_eq!(mic.level, 0.0);
        prod.push_slice(&[0.3; 50]);
        assert_eq!(mic.drain(&mut cons, true, tick).unwrap(), Some(false), "audio is back");
        assert!(!mic.stopped());

        // Exact zeros for 30 s: silent, not stopped.
        let mut mic = Stem::new("mic", &dir, rate, &key);
        for _ in 0..29 {
            prod.push_slice(&[0.0; 1_000]);
            assert_eq!(mic.drain(&mut cons, true, Duration::from_secs(1)).unwrap(), None);
        }
        prod.push_slice(&[0.0; 1_000]);
        assert_eq!(mic.drain(&mut cons, true, Duration::from_secs(1)).unwrap(), Some(true));
        assert!(!mic.stopped());

        // Paused: nothing is kept and the watches wait.
        let mut mic = Stem::new("mic", &dir, rate, &key);
        for _ in 0..20 {
            assert_eq!(mic.drain(&mut cons, false, Duration::from_secs(1)).unwrap(), None);
        }

        // The system tap delivers zeros when the call is quiet, never nothing; an empty ring isn't a warning.
        let mut system = Stem::new("system", &dir, rate, &key);
        for _ in 0..20 {
            assert_eq!(system.drain(&mut cons, true, Duration::from_secs(1)).unwrap(), None);
        }
    }

    #[test]
    fn the_quiet_window_is_the_rms_of_what_was_kept() {
        use ringbuf::traits::{Producer, Split};
        let key = crate::at_rest::new_key().unwrap();
        let (mut prod, mut cons) = ringbuf::HeapRb::<f32>::new(4_000).split();
        let mut stem = Stem::new("system", &std::env::temp_dir(), 1_000, &key);
        prod.push_slice(&[0.5; 500]);
        prod.push_slice(&[-0.5; 500]);
        stem.drain(&mut cons, true, Duration::from_secs(1)).unwrap();
        assert!((stem.take_window_rms() - 0.5).abs() < 1e-4);
        assert_eq!(stem.take_window_rms(), 0.0, "a new window starts empty");
        prod.push_slice(&[0.5; 500]);
        stem.drain(&mut cons, false, Duration::from_secs(1)).unwrap();
        assert_eq!(stem.take_window_rms(), 0.0, "paused audio doesn't count");
    }

    #[test]
    fn a_stem_writes_its_chunk_encrypted_and_it_decrypts_to_the_same_audio() {
        use ringbuf::traits::{Producer, Split};
        let dir = std::env::temp_dir().join(format!("aftercall-recorder-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let key = crate::at_rest::new_key().unwrap();
        let (mut prod, mut cons) = ringbuf::HeapRb::<f32>::new(64_000).split();
        let mut stem = Stem::new("mic", &dir, TARGET_RATE, &key);
        stem.open(0).unwrap();
        // 2.5 s of a tone at 16 kHz: two whole frames and a half one sealed on close.
        let tone: Vec<f32> = (0..40_000).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
        for part in tone.chunks(8_000) {
            prod.push_slice(part);
            stem.drain(&mut cons, true, Duration::from_millis(500)).unwrap();
        }
        stem.close().unwrap();

        let raw = fs::read(chunk_path(&dir, "mic", 0)).unwrap();
        assert!(!raw.starts_with(b"RIFF"), "a plaintext WAV header on disk");
        assert!(!raw.windows(4).any(|w| w == b"WAVE" || w == b"data"));
        let wav = crate::at_rest::open_audio(&key, &raw).unwrap();
        let reader = hound::WavReader::new(std::io::Cursor::new(wav.to_vec())).unwrap();
        assert_eq!((reader.spec().sample_rate, reader.spec().channels, reader.spec().bits_per_sample), (TARGET_RATE, 1, 16));
        let samples: Vec<i16> = reader.into_samples::<i16>().map(Result::unwrap).collect();
        assert!((samples.len() as i64 - 40_000).abs() <= 2, "{} samples", samples.len());
        // At 16 kHz the resampler passes samples through, one sample late.
        assert_eq!(samples[1001], (tone[1000] * i16::MAX as f32) as i16);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn chunks_are_numbered_per_stem() {
        let p = chunk_path(Path::new("/tmp/m"), "system", 7);
        assert_eq!(p, PathBuf::from("/tmp/m/system-007.wav"));
    }
}
