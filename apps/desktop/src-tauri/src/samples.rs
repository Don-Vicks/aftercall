//! Fictional sample recordings (samples/, made by scripts/make-samples.mjs), built
//! into the app so anyone can try the real notes pipeline without recording a call.
//!
//! Opening a sample copies its two stems into the recordings folder as an ordinary
//! recording labelled "Sample". From there it is processed like any other: the same
//! NEAR AI calls, the same proof, and its audio is deleted afterwards.

use std::path::{Path, PathBuf};

struct Sample {
    id: &'static str,
    meeting: &'static str,
    mic: &'static [u8],
    system: &'static [u8],
}

const SAMPLES: &[Sample] = &[
    Sample {
        id: "designer-kickoff",
        meeting: include_str!("../../../../samples/designer-kickoff/meeting.json"),
        mic: include_bytes!("../../../../samples/designer-kickoff/mic-000.wav"),
        system: include_bytes!("../../../../samples/designer-kickoff/system-000.wav"),
    },
    Sample {
        id: "team-checkin",
        meeting: include_str!("../../../../samples/team-checkin/meeting.json"),
        mic: include_bytes!("../../../../samples/team-checkin/mic-000.wav"),
        system: include_bytes!("../../../../samples/team-checkin/system-000.wav"),
    },
];

/// Copies sample `sample` into `recordings/<new id>/` and returns that folder.
/// `project` files it under one of the user's projects; `now` is Unix seconds.
pub fn install(recordings: &Path, sample: &str, project: &str, now: u64) -> Result<PathBuf, String> {
    let s = SAMPLES.iter().find(|s| s.id == sample).ok_or("No such sample")?;
    std::fs::create_dir_all(recordings).map_err(|e| e.to_string())?;
    // Recording ids are the start time in seconds; step past any that are taken.
    let mut id = now;
    while recordings.join(id.to_string()).exists() {
        id += 1;
    }
    let dir = recordings.join(id.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut meta: serde_json::Value = serde_json::from_str(s.meeting).map_err(|e| e.to_string())?;
    meta["id"] = id.to_string().into();
    meta["startedAt"] = id.into();
    meta["dir"] = dir.display().to_string().into();
    let project = project.trim();
    if !project.is_empty() && project.chars().count() <= 60 {
        meta["project"] = project.into();
    }
    // Fictional, but stored like any recording: sealed with the data key, never plaintext on disk.
    crate::at_rest::write_bytes(&dir.join("mic-000.wav"), s.mic)?;
    crate::at_rest::write_bytes(&dir.join("system-000.wav"), s.system)?;
    // meeting.json last: list_recordings only shows folders that have one.
    crate::at_rest::write_json(&dir.join("meeting.json"), &meta)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_are_16khz_mono_16bit_like_the_recorder_writes() {
        for s in SAMPLES {
            for wav in [s.mic, s.system] {
                let spec = hound::WavReader::new(std::io::Cursor::new(wav)).unwrap().spec();
                assert_eq!((spec.channels, spec.sample_rate, spec.bits_per_sample), (1, 16_000, 16), "{}", s.id);
            }
        }
    }

    #[test]
    fn a_sample_becomes_an_ordinary_labelled_recording() {
        let root = std::env::temp_dir().join(format!("aftercall-samples-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let first = install(&root, "designer-kickoff", "General", 1_800_000_000).unwrap();
        let second = install(&root, "designer-kickoff", "", 1_800_000_000).unwrap();
        assert_eq!(first, root.join("1800000000"));
        assert_eq!(second, root.join("1800000001"), "a taken id is skipped");

        let meta: serde_json::Value = serde_json::from_str(&crate::at_rest::read_string(&first.join("meeting.json")).unwrap()).unwrap();
        assert_eq!(meta["id"], "1800000000");
        assert_eq!(meta["startedAt"], 1_800_000_000u64);
        assert_eq!(meta["project"], "General");
        assert_eq!(meta["label"], "Sample");
        assert_eq!(meta["chunks"], 1);
        assert!(first.join("mic-000.wav").exists() && first.join("system-000.wav").exists());

        let kept: serde_json::Value = serde_json::from_str(&crate::at_rest::read_string(&second.join("meeting.json")).unwrap()).unwrap();
        assert!(kept["project"].as_str().unwrap().starts_with("Sample"), "no project keeps the sample's own");
        assert!(install(&root, "../etc", "General", 1).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
