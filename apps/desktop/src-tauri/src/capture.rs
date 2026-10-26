//! Audio sources: macOS system audio through a Core Audio process tap, and the
//! default microphone through cpal. Each source pushes mono f32 samples into a
//! ring buffer that the recorder thread drains.
//!
//! The process tap needs macOS 14.2+ and an app bundle whose Info.plist has
//! `NSAudioCaptureUsageDescription`; without it the tap delivers silence, which
//! the silence watchdog reports.

use anyhow::{bail, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::{Producer, Split};
use ringbuf::{HeapCons, HeapRb};

const RING_SECONDS: usize = 10;

pub struct Source {
    pub sample_rate: u32,
    pub samples: HeapCons<f32>,
    pub name: String,
}

// ---------- system audio (process tap) ----------

#[cfg(target_os = "macos")]
pub use speaker::start_speaker;

#[cfg(target_os = "macos")]
mod speaker {
    use super::*;
    use cidre::{arc, av, cat, cf, core_audio as ca, ns, os};
    use ringbuf::HeapProd;

    use ca::aggregate_device_keys as agg_keys;

    struct TapCtx {
        format: av::audio::CommonFormat,
        producer: HeapProd<f32>,
        scratch: Vec<f32>,
    }

    /// Keeps the tap and its aggregate device alive; dropping it stops capture.
    pub struct Speaker {
        _tap: ca::TapGuard,
        _device: ca::hardware::StartedDevice<ca::AggregateDevice>,
        _ctx: Box<TapCtx>,
    }

    extern "C" fn tap_proc(
        _device: ca::Device,
        _now: &cat::AudioTimeStamp,
        input_data: &cat::AudioBufList<1>,
        _input_time: &cat::AudioTimeStamp,
        _output_data: &mut cat::AudioBufList<1>,
        _output_time: &cat::AudioTimeStamp,
        ctx: Option<&mut TapCtx>,
    ) -> os::Status {
        let Some(ctx) = ctx else { return os::Status::NO_ERR };
        let buf = &input_data.buffers[0];
        if buf.data_bytes_size == 0 || buf.data.is_null() {
            return os::Status::NO_ERR;
        }
        let bytes = buf.data_bytes_size as usize;
        match ctx.format {
            av::audio::CommonFormat::PcmF32 => {
                let s = unsafe { std::slice::from_raw_parts(buf.data as *const f32, bytes / 4) };
                ctx.producer.push_slice(s);
            }
            av::audio::CommonFormat::PcmI16 => {
                let s = unsafe { std::slice::from_raw_parts(buf.data as *const i16, bytes / 2) };
                let n = s.len().min(ctx.scratch.len());
                for (d, v) in ctx.scratch[..n].iter_mut().zip(s) {
                    *d = *v as f32 / i16::MAX as f32;
                }
                ctx.producer.push_slice(&ctx.scratch[..n]);
            }
            _ => {}
        }
        os::Status::NO_ERR
    }

    /// Taps all system output except Aftercall's own, mixed to mono.
    pub fn start_speaker() -> Result<(Speaker, Source)> {
        let tap_desc = ca::TapDesc::with_mono_global_tap_excluding_processes(&ns::Array::new());
        let tap = tap_desc.create_process_tap().context("creating the system audio tap")?;
        let tap_uid = tap.uid()?;
        let asbd = tap.asbd()?;
        let sample_rate = asbd.sample_rate as u32;

        let sub_tap = cf::DictionaryOf::with_keys_values(&[ca::sub_device_keys::uid()], &[tap_uid.as_type_ref()]);
        let agg_desc: arc::Retained<cf::DictionaryOf<cf::String, cf::Type>> = cf::DictionaryOf::with_keys_values(
            &[agg_keys::is_private(), agg_keys::tap_auto_start(), agg_keys::name(), agg_keys::uid(), agg_keys::tap_list()],
            &[
                cf::Boolean::value_true().as_type_ref(),
                cf::Boolean::value_false(),
                cf::String::from_str("Aftercall Tap").as_ref(),
                &cf::Uuid::new().to_cf_string(),
                &cf::ArrayOf::from_slice(&[sub_tap.as_ref()]),
            ],
        );

        let format = av::AudioFormat::with_asbd(&asbd).context("unsupported system audio format")?.common_format();
        let (producer, consumer) = HeapRb::<f32>::new(sample_rate as usize * RING_SECONDS).split();
        let mut ctx = Box::new(TapCtx { format, producer, scratch: vec![0.0; 16384] });

        let agg_device = ca::AggregateDevice::with_desc(&agg_desc)?;
        let proc_id = agg_device.create_io_proc_id(tap_proc, Some(&mut ctx))?;
        let device = ca::device_start(agg_device, Some(proc_id))?;

        Ok((
            Speaker { _tap: tap, _device: device, _ctx: ctx },
            Source { sample_rate, samples: consumer, name: "System audio".into() },
        ))
    }
}

// ---------- microphone (cpal) ----------

/// Starts the default input device, mixed to mono. Dropping the stream stops it.
pub fn start_mic() -> Result<(cpal::Stream, Source)> {
    let host = cpal::default_host();
    let device = host.default_input_device().context("no microphone found")?;
    let config = device.default_input_config()?;
    let sample_rate = config.sample_rate();
    let channels = config.channels() as usize;
    let (mut producer, consumer) = HeapRb::<f32>::new(sample_rate as usize * RING_SECONDS).split();
    let on_error = |e| eprintln!("microphone stream error: {e}");
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.clone().into(),
            move |data: &[f32], _| {
                for frame in data.chunks(channels) {
                    let _ = producer.try_push(frame.iter().sum::<f32>() / channels as f32);
                }
            },
            on_error,
            None,
        )?,
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.clone().into(),
            move |data: &[i16], _| {
                for frame in data.chunks(channels) {
                    let s: f32 = frame.iter().map(|v| *v as f32 / i16::MAX as f32).sum();
                    let _ = producer.try_push(s / channels as f32);
                }
            },
            on_error,
            None,
        )?,
        f => bail!("unsupported microphone sample format {f:?}"),
    };
    stream.play()?;
    #[allow(deprecated)]
    let name = device.name().unwrap_or_else(|_| "Microphone".into());
    Ok((stream, Source { sample_rate, samples: consumer, name }))
}
