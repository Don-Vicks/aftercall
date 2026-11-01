//! Encryption at rest for everything Aftercall keeps about a meeting: audio chunks,
//! cached chunk transcriptions, meeting.json, notes.json and projects.json.
//!
//! One random 32-byte data key is made on first use and kept in the macOS Keychain
//! (service `dev.aftercall.app`, account `data-key`). Files are sealed with
//! XChaCha20-Poly1305 behind a small versioned header:
//!
//! ```text
//! sealed file:  "ACREST" | version 1 | kind 1 (blob) | nonce (24) | ciphertext+tag
//! audio chunk:  "ACREST" | version 1 | kind 2 (audio) | stream id (16) | sample rate (u32 LE)
//!               then frames: ciphertext length (u32 LE) | nonce (24) | ciphertext+tag
//! ```
//!
//! The header is the associated data of a blob. An audio frame's associated data is
//! the chunk header plus the frame's index, so frames can't be reordered or moved
//! between chunks. Audio frames hold about one second of 16-bit PCM each and are
//! appended as the recorder goes, so a crash loses at most the last second and no
//! plaintext audio is ever written to disk. A cut-short chunk (a crash) is read up to
//! its last whole frame; dropped trailing frames are therefore not detected.
//!
//! Chunks keep their `mic-000.wav` names so the rest of the app is unchanged, but
//! their bytes are not a WAV file; [`read_audio`] rebuilds the WAV in memory.
//!
//! Files written by earlier versions (plaintext JSON, RIFF WAV) are still read, and
//! [`migrate`] seals them at startup; any save also writes them sealed.
//!
//! Limits: the key sits in the user's login Keychain, so the user's own unlocked
//! session, or software running as the user that is allowed into the Keychain, can
//! get it. This keeps other apps, backup and sync tools from reading meetings off
//! the disk; it does not protect against a compromised account.

use std::fs::OpenOptions;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde_json::Value;
use zeroize::Zeroizing;

pub type Key = Zeroizing<[u8; 32]>;

const MAGIC: &[u8] = b"ACREST";
const VERSION: u8 = 1;
const KIND_BLOB: u8 = 1;
const KIND_AUDIO: u8 = 2;
const HEADER_LEN: usize = MAGIC.len() + 2;
const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;
const STREAM_ID_LEN: usize = 16;
const AUDIO_HEADER_LEN: usize = HEADER_LEN + STREAM_ID_LEN + 4;
/// One second of 16 kHz mono 16-bit audio per frame.
pub const FRAME_BYTES: usize = 32_000;
/// No frame is larger than this; a bigger length means a damaged file.
const MAX_FRAME: usize = 1 << 20;

const KEYCHAIN_SERVICE: &str = "dev.aftercall.app";
const KEYCHAIN_ACCOUNT: &str = "data-key";

// ---------- the key ----------

static KEY: Mutex<Option<Key>> = Mutex::new(None);

/// The data key: from the Keychain, made once if there is none. Cached for the session.
/// A Keychain error (locked, access refused) is returned as is: a new key is made only
/// when there is no entry at all, so existing files never become unreadable that way.
#[cfg(not(test))]
pub fn data_key() -> Result<Key, String> {
    use base64::Engine as _;
    let mut slot = KEY.lock().map_err(|e| e.to_string())?;
    if let Some(k) = slot.as_ref() {
        return Ok(k.clone());
    }
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD;
    let key = match entry.get_password() {
        Ok(encoded) => {
            let encoded = Zeroizing::new(encoded);
            let bytes = Zeroizing::new(b64.decode(encoded.as_bytes()).map_err(|_| "The data key in the Keychain is damaged".to_string())?);
            let mut key = Key::default();
            if bytes.len() != 32 {
                return Err("The data key in the Keychain is damaged".into());
            }
            key.copy_from_slice(&bytes);
            key
        }
        Err(keyring::Error::NoEntry) => {
            let key = new_key()?;
            let encoded = Zeroizing::new(b64.encode(key.as_ref()));
            entry
                .set_password(&encoded)
                .map_err(|e| format!("macOS Keychain didn't save Aftercall's data key ({e}). If macOS asked, choose Allow or Always Allow."))?;
            key
        }
        Err(e) => return Err(format!("Aftercall couldn't open its data key in the Keychain ({e}). If macOS asked, choose Allow.")),
    };
    *slot = Some(key.clone());
    Ok(key)
}

/// Tests never touch the Keychain: they use a fixed key.
#[cfg(test)]
pub fn data_key() -> Result<Key, String> {
    let _ = (&KEY, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    Ok(Zeroizing::new([7u8; 32]))
}

/// Forgets the cached data key ("Delete everything" removed it from the Keychain),
/// so the next file written gets a new key instead of one nobody can find again.
pub fn forget_data_key() {
    if let Ok(mut slot) = KEY.lock() {
        *slot = None;
    }
}

pub fn new_key() -> Result<Key, String> {
    let mut key = Key::default();
    getrandom::getrandom(key.as_mut()).map_err(|e| e.to_string())?;
    Ok(key)
}

fn header(kind: u8) -> [u8; HEADER_LEN] {
    let mut h = [0u8; HEADER_LEN];
    h[..MAGIC.len()].copy_from_slice(MAGIC);
    h[MAGIC.len()] = VERSION;
    h[MAGIC.len() + 1] = kind;
    h
}

fn nonce() -> Result<[u8; NONCE_LEN], String> {
    let mut n = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut n).map_err(|e| e.to_string())?;
    Ok(n)
}

/// True for anything this module wrote (any kind, any version).
pub fn is_sealed(bytes: &[u8]) -> bool {
    bytes.starts_with(MAGIC)
}

fn kind_of(bytes: &[u8]) -> Result<u8, String> {
    if bytes.len() < HEADER_LEN || !is_sealed(bytes) {
        return Err("Not an Aftercall encrypted file".into());
    }
    if bytes[MAGIC.len()] != VERSION {
        return Err("This file was written by a newer Aftercall. Update the app.".into());
    }
    Ok(bytes[MAGIC.len() + 1])
}

// ---------- blobs (JSON files) ----------

pub fn seal(key: &Key, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let h = header(KIND_BLOB);
    let n = nonce()?;
    let sealed = XChaCha20Poly1305::new(key.as_ref().into())
        .encrypt(XNonce::from_slice(&n), Payload { msg: plaintext, aad: &h })
        .map_err(|_| "Encryption failed".to_string())?;
    let mut out = Vec::with_capacity(HEADER_LEN + NONCE_LEN + sealed.len());
    out.extend_from_slice(&h);
    out.extend_from_slice(&n);
    out.extend_from_slice(&sealed);
    Ok(out)
}

pub fn open(key: &Key, bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    if kind_of(bytes)? != KIND_BLOB {
        return Err("Not an encrypted Aftercall file".into());
    }
    let (h, rest) = bytes.split_at(HEADER_LEN);
    if rest.len() < NONCE_LEN + TAG_LEN {
        return Err("This file is cut short".into());
    }
    let (n, sealed) = rest.split_at(NONCE_LEN);
    XChaCha20Poly1305::new(key.as_ref().into())
        .decrypt(XNonce::from_slice(n), Payload { msg: sealed, aad: h })
        .map(Zeroizing::new)
        .map_err(|_| "This file can't be decrypted: it was changed, or sealed with another key".to_string())
}

/// The bytes of a file this module manages: decrypted when sealed, as they are when
/// written by an earlier version (plaintext).
pub fn read_bytes(path: &Path) -> Result<Zeroizing<Vec<u8>>, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if is_sealed(&bytes) { open(&data_key()?, &bytes) } else { Ok(Zeroizing::new(bytes)) }
}

pub fn read_string(path: &Path) -> Result<String, String> {
    let bytes = read_bytes(path)?;
    String::from_utf8(bytes.to_vec()).map_err(|_| "This file isn't text".to_string())
}

pub fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&read_bytes(path).ok()?).ok()
}

/// Seals `contents` and writes it atomically: a 0600 temp file next to `path`, renamed over it.
pub fn write_bytes(path: &Path, contents: &[u8]) -> Result<(), String> {
    let sealed = seal(&data_key()?, contents)?;
    write_raw_atomic(path, &sealed)
}

pub fn write_string(path: &Path, contents: &str) -> Result<(), String> {
    write_bytes(path, contents.as_bytes())
}

pub fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    write_string(path, &serde_json::to_string_pretty(value).map_err(|e| e.to_string())?)
}

fn write_raw_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".tmp-{}-{nanos:x}", std::process::id()));
    let tmp = PathBuf::from(tmp);
    let written = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)
        .and_then(|mut f| f.write_all(bytes).and_then(|_| f.sync_all()));
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

// ---------- audio ----------

/// Writes one audio chunk as encrypted frames of 16-bit PCM, one frame per second.
pub struct AudioWriter {
    file: std::fs::File,
    key: Key,
    prefix: [u8; AUDIO_HEADER_LEN],
    index: u64,
    buf: Zeroizing<Vec<u8>>,
}

impl AudioWriter {
    pub fn create(path: &Path, key: &Key, sample_rate: u32) -> Result<Self, String> {
        let mut prefix = [0u8; AUDIO_HEADER_LEN];
        prefix[..HEADER_LEN].copy_from_slice(&header(KIND_AUDIO));
        getrandom::getrandom(&mut prefix[HEADER_LEN..HEADER_LEN + STREAM_ID_LEN]).map_err(|e| e.to_string())?;
        prefix[HEADER_LEN + STREAM_ID_LEN..].copy_from_slice(&sample_rate.to_le_bytes());
        let mut file = OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path).map_err(|e| e.to_string())?;
        file.write_all(&prefix).map_err(|e| e.to_string())?;
        Ok(Self { file, key: key.clone(), prefix, index: 0, buf: Zeroizing::new(Vec::with_capacity(FRAME_BYTES)) })
    }

    pub fn write_sample(&mut self, s: i16) -> Result<(), String> {
        self.buf.extend_from_slice(&s.to_le_bytes());
        if self.buf.len() >= FRAME_BYTES { self.flush_frame() } else { Ok(()) }
    }

    fn flush_frame(&mut self) -> Result<(), String> {
        if self.buf.is_empty() {
            return Ok(());
        }
        let n = nonce()?;
        let aad = frame_aad(&self.prefix, self.index);
        let sealed = XChaCha20Poly1305::new(self.key.as_ref().into())
            .encrypt(XNonce::from_slice(&n), Payload { msg: &self.buf, aad: &aad })
            .map_err(|_| "Encryption failed".to_string())?;
        let mut frame = Vec::with_capacity(4 + NONCE_LEN + sealed.len());
        frame.extend_from_slice(&(sealed.len() as u32).to_le_bytes());
        frame.extend_from_slice(&n);
        frame.extend_from_slice(&sealed);
        self.file.write_all(&frame).map_err(|e| e.to_string())?;
        self.buf.clear();
        self.index += 1;
        Ok(())
    }

    /// Seals what's left and syncs the file.
    pub fn finish(mut self) -> Result<(), String> {
        self.flush_frame()?;
        self.file.sync_all().map_err(|e| e.to_string())
    }
}

fn frame_aad(prefix: &[u8; AUDIO_HEADER_LEN], index: u64) -> [u8; AUDIO_HEADER_LEN + 8] {
    let mut aad = [0u8; AUDIO_HEADER_LEN + 8];
    aad[..AUDIO_HEADER_LEN].copy_from_slice(prefix);
    aad[AUDIO_HEADER_LEN..].copy_from_slice(&index.to_le_bytes());
    aad
}

/// A 44-byte PCM WAV header for 16-bit mono audio.
pub fn wav_header(sample_rate: u32, data_len: u32) -> [u8; 44] {
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_len).to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&1u16.to_le_bytes()); // mono
    h[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    h[28..32].copy_from_slice(&(sample_rate * 2).to_le_bytes());
    h[32..34].copy_from_slice(&2u16.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_len.to_le_bytes());
    h
}

/// Decrypts an encrypted audio chunk into WAV bytes, in memory. A partial last frame
/// (a crash mid-write) is dropped; a changed byte in any whole frame is an error.
pub fn open_audio(key: &Key, bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    match kind_of(bytes)? {
        // A WAV sealed whole (an earlier version's chunk, migrated).
        KIND_BLOB => return open(key, bytes),
        KIND_AUDIO => {}
        _ => return Err("Not an Aftercall audio file".into()),
    }
    if bytes.len() < AUDIO_HEADER_LEN {
        return Err("This audio file is cut short".into());
    }
    let mut prefix = [0u8; AUDIO_HEADER_LEN];
    prefix.copy_from_slice(&bytes[..AUDIO_HEADER_LEN]);
    let rate = u32::from_le_bytes(prefix[HEADER_LEN + STREAM_ID_LEN..].try_into().expect("4 bytes"));
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    let mut pcm = Zeroizing::new(Vec::with_capacity(bytes.len()));
    let mut rest = &bytes[AUDIO_HEADER_LEN..];
    let mut index = 0u64;
    while rest.len() >= 4 {
        let len = u32::from_le_bytes(rest[..4].try_into().expect("4 bytes")) as usize;
        if !(TAG_LEN..=MAX_FRAME).contains(&len) {
            return Err("This audio file is damaged".into());
        }
        if rest.len() < 4 + NONCE_LEN + len {
            break; // cut short by a crash: keep the whole frames before it
        }
        let (n, sealed) = rest[4..4 + NONCE_LEN + len].split_at(NONCE_LEN);
        let plain = Zeroizing::new(
            cipher
                .decrypt(XNonce::from_slice(n), Payload { msg: sealed, aad: &frame_aad(&prefix, index) })
                .map_err(|_| "This audio file can't be decrypted: it was changed, or sealed with another key".to_string())?,
        );
        pcm.extend_from_slice(&plain);
        rest = &rest[4 + NONCE_LEN + len..];
        index += 1;
    }
    let mut wav = Zeroizing::new(Vec::with_capacity(44 + pcm.len()));
    wav.extend_from_slice(&wav_header(rate, pcm.len() as u32));
    wav.extend_from_slice(&pcm);
    Ok(wav)
}

/// A chunk as WAV bytes for upload, decrypted in memory. Never writes a decrypted file.
/// A plaintext WAV from an earlier version is returned as it is.
pub fn read_audio(path: &Path) -> Result<Zeroizing<Vec<u8>>, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if is_sealed(&bytes) { open_audio(&data_key()?, &bytes) } else { Ok(Zeroizing::new(bytes)) }
}

// ---------- migration ----------

/// Seals one plaintext file in place. Returns whether it changed anything.
pub fn migrate_file(path: &Path) -> Result<bool, String> {
    let bytes = Zeroizing::new(std::fs::read(path).map_err(|e| e.to_string())?);
    if is_sealed(&bytes) {
        return Ok(false);
    }
    write_bytes(path, &bytes)?;
    Ok(true)
}

/// Seals every plaintext file an earlier version left: projects.json, and per
/// recording meeting.json, notes.json (under its lock), cached transcripts and WAV chunks.
/// Returns how many files were sealed.
pub fn migrate(data_dir: &Path) -> Result<usize, String> {
    let mut sealed = 0;
    let mut one = |path: &Path| match migrate_file(path) {
        Ok(true) => sealed += 1,
        Ok(false) => {}
        Err(e) => eprintln!("at-rest migration: {}: {e}", path.file_name().and_then(|n| n.to_str()).unwrap_or("?")),
    };
    let projects = data_dir.join("projects.json");
    if projects.exists() {
        one(&projects);
    }
    let Ok(entries) = std::fs::read_dir(data_dir.join("recordings")) else { return Ok(0) };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if name == "meeting.json" || name.ends_with(".wav") {
                one(&p);
            } else if name == "notes.json" {
                let _ = crate::notes_file::with_lock(&p, || {
                    one(&p);
                    Ok(())
                });
            }
        }
        for e in std::fs::read_dir(dir.join("transcripts")).into_iter().flatten().flatten() {
            if e.path().extension().and_then(|x| x.to_str()) == Some("json") {
                one(&e.path());
            }
        }
    }
    Ok(sealed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aftercall-at-rest-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn blob_round_trips_and_hides_the_text() {
        let key = new_key().unwrap();
        let sealed = seal(&key, b"{\"title\":\"Board sync\"}").unwrap();
        assert!(sealed.starts_with(b"ACREST\x01\x01"));
        assert!(!sealed.windows(5).any(|w| w == b"Board"));
        assert_eq!(open(&key, &sealed).unwrap().as_slice(), b"{\"title\":\"Board sync\"}");
        // Same plaintext, new nonce, different bytes.
        assert_ne!(seal(&key, b"x").unwrap(), seal(&key, b"x").unwrap());
    }

    #[test]
    fn wrong_key_fails() {
        let sealed = seal(&new_key().unwrap(), b"secret").unwrap();
        assert!(open(&new_key().unwrap(), &sealed).unwrap_err().contains("another key"));
    }

    #[test]
    fn any_tampered_byte_fails() {
        let key = new_key().unwrap();
        let sealed = seal(&key, b"secret notes").unwrap();
        for i in 0..sealed.len() {
            let mut t = sealed.clone();
            t[i] ^= 0x01;
            assert!(open(&key, &t).is_err(), "flipping byte {i} went unnoticed");
        }
        assert!(open(&key, &sealed[..sealed.len() - 1]).is_err());
        assert!(open(&key, b"ACREST").is_err());
    }

    #[test]
    fn plaintext_files_are_read_then_sealed_by_migration() {
        let dir = temp_dir("migrate");
        let rec = dir.join("recordings/1700000000");
        std::fs::create_dir_all(rec.join("transcripts")).unwrap();
        std::fs::write(dir.join("projects.json"), r#"[{"id":"general","name":"General"}]"#).unwrap();
        std::fs::write(rec.join("meeting.json"), r#"{"id":"1700000000"}"#).unwrap();
        std::fs::write(rec.join("notes.json"), r#"{"meeting":{"title":"Old"}}"#).unwrap();
        std::fs::write(rec.join("transcripts/mic-000.json"), r#"{"text":"hello"}"#).unwrap();
        let wav = [wav_header(16_000, 4).as_slice(), &[1, 0, 2, 0]].concat();
        std::fs::write(rec.join("mic-000.wav"), &wav).unwrap();

        // Plaintext from an earlier version reads as it is.
        assert_eq!(read_json(&rec.join("notes.json")).unwrap()["meeting"]["title"], "Old");
        assert_eq!(read_audio(&rec.join("mic-000.wav")).unwrap().as_slice(), wav.as_slice());

        assert_eq!(migrate(&dir).unwrap(), 5);
        for f in ["projects.json", "recordings/1700000000/meeting.json", "recordings/1700000000/notes.json", "recordings/1700000000/transcripts/mic-000.json", "recordings/1700000000/mic-000.wav"] {
            assert!(is_sealed(&std::fs::read(dir.join(f)).unwrap()), "{f} is still plaintext");
        }
        assert_eq!(read_json(&rec.join("notes.json")).unwrap()["meeting"]["title"], "Old");
        assert_eq!(read_string(&rec.join("transcripts/mic-000.json")).unwrap(), r#"{"text":"hello"}"#);
        assert_eq!(read_audio(&rec.join("mic-000.wav")).unwrap().as_slice(), wav.as_slice());
        // Running it again changes nothing, and no temp or lock files are left.
        assert_eq!(migrate(&dir).unwrap(), 0);
        let mut left: Vec<_> = std::fs::read_dir(&rec).unwrap().flatten().map(|e| e.file_name().into_string().unwrap()).collect();
        left.sort();
        assert_eq!(left, ["meeting.json", "mic-000.wav", "notes.json", "transcripts"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn writes_are_sealed_and_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("write");
        let f = dir.join("notes.json");
        write_string(&f, "{\"a\":1}").unwrap();
        let raw = std::fs::read(&f).unwrap();
        assert!(is_sealed(&raw));
        assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(read_string(&f).unwrap(), "{\"a\":1}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn write_chunk(path: &Path, key: &Key, samples: &[i16]) {
        let mut w = AudioWriter::create(path, key, 16_000).unwrap();
        for &s in samples {
            w.write_sample(s).unwrap();
        }
        w.finish().unwrap();
    }

    #[test]
    fn audio_round_trips_as_a_wav_and_has_no_riff_on_disk() {
        let dir = temp_dir("audio");
        let key = new_key().unwrap();
        let f = dir.join("mic-000.wav");
        let samples: Vec<i16> = (0..40_000).map(|i| (i % 2000) as i16 - 1000).collect();
        write_chunk(&f, &key, &samples);
        let raw = std::fs::read(&f).unwrap();
        assert!(!raw.starts_with(b"RIFF") && !raw.windows(4).any(|w| w == b"WAVE"));
        let wav = open_audio(&key, &raw).unwrap();
        let reader = hound::WavReader::new(std::io::Cursor::new(wav.to_vec())).unwrap();
        assert_eq!(reader.spec().sample_rate, 16_000);
        assert_eq!(reader.into_samples::<i16>().map(Result::unwrap).collect::<Vec<_>>(), samples);
        assert!(open_audio(&new_key().unwrap(), &raw).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn audio_cut_short_keeps_whole_frames_but_tampering_fails() {
        let dir = temp_dir("audio-cut");
        let key = new_key().unwrap();
        let f = dir.join("mic-000.wav");
        write_chunk(&f, &key, &vec![5i16; 16_000 * 3]); // three whole frames
        let raw = std::fs::read(&f).unwrap();
        let cut = &raw[..raw.len() - 100];
        assert_eq!(open_audio(&key, cut).unwrap().len(), 44 + FRAME_BYTES * 2);

        let mut tampered = raw.clone();
        let mid = AUDIO_HEADER_LEN + 4 + NONCE_LEN + 10;
        tampered[mid] ^= 1;
        assert!(open_audio(&key, &tampered).is_err());
        // Swapping two frames is caught by the frame index in the associated data.
        let frame = 4 + NONCE_LEN + FRAME_BYTES + TAG_LEN;
        let body = &raw[AUDIO_HEADER_LEN..];
        let swapped = [&raw[..AUDIO_HEADER_LEN], &body[frame..2 * frame], &body[..frame], &body[2 * frame..]].concat();
        assert!(open_audio(&key, &swapped).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
