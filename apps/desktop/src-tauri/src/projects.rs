//! The user's projects and their briefs, in `projects.json` in the app's folder.
//!
//! The file is sealed with the data key like every meeting file (`at_rest.rs`), so a
//! brief is never on disk in plaintext. A file from an earlier version, with only `id`
//! and `name` per project (plaintext or sealed), still loads: a missing brief is none.
//! A brief is what the user wrote about a project so the notes understand it; it leaves
//! the Mac only inside the end-to-end encrypted notes and Ask requests, except its
//! words to expect, which also go with the audio as Whisper's spelling prompt. Coding
//! agents never get it (`public_list`).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::at_rest;

/// The same limits as `BRIEF_LIMITS` in `packages/core/src/notes/pipeline.ts`.
pub const ABOUT_MAX: usize = 400;
pub const WATCH_FOR_MAX: usize = 300;
pub const PEOPLE_MAX: usize = 20;
pub const NAME_MAX: usize = 60;
pub const ROLE_MAX: usize = 80;
pub const WORDS_MAX: usize = 30;
pub const WORD_MAX: usize = 40;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BriefPerson {
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub role: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Brief {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub about: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub people: Vec<BriefPerson>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<String>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub watch_for: String,
}

impl Brief {
    fn is_empty(&self) -> bool {
        self.about.is_empty() && self.people.is_empty() && self.words.is_empty() && self.watch_for.is_empty()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brief: Option<Brief>,
}

pub fn path(data_dir: &Path) -> PathBuf {
    data_dir.join("projects.json")
}

fn general() -> Vec<Project> {
    vec![Project { id: "general".into(), name: "General".into(), brief: None }]
}

/// The projects, briefs included. A first run (no file, or one that can't be read) starts with "General".
pub fn load(data_dir: &Path) -> Result<Vec<Project>, String> {
    match at_rest::read_string(&path(data_dir)) {
        Ok(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
        Err(_) => Ok(general()),
    }
}

fn too_long(s: &str, max: usize) -> bool {
    s.chars().count() > max
}

/// Checks a brief against the limits; the interface cleans it first (`cleanBrief`).
pub fn check_brief(b: &Brief) -> Result<(), String> {
    let has_markers = |s: &str| s.contains("<<<") || s.contains(">>>");
    if too_long(&b.about, ABOUT_MAX) || too_long(&b.watch_for, WATCH_FOR_MAX) {
        return Err(format!("Keep About under {ABOUT_MAX} characters and What to watch for under {WATCH_FOR_MAX}"));
    }
    if b.people.len() > PEOPLE_MAX || b.people.iter().any(|p| p.name.trim().is_empty() || too_long(&p.name, NAME_MAX) || too_long(&p.role, ROLE_MAX)) {
        return Err(format!("A brief lists at most {PEOPLE_MAX} people, each with a name"));
    }
    if b.words.len() > WORDS_MAX || b.words.iter().any(|w| w.trim().is_empty() || too_long(w, WORD_MAX)) {
        return Err(format!("A brief has at most {WORDS_MAX} words to expect, each under {WORD_MAX} characters"));
    }
    let texts = [b.about.as_str(), b.watch_for.as_str()].into_iter().chain(b.people.iter().flat_map(|p| [p.name.as_str(), p.role.as_str()])).chain(b.words.iter().map(String::as_str));
    if texts.into_iter().any(has_markers) {
        return Err("A brief can't contain <<< or >>>".into());
    }
    Ok(())
}

pub fn check(projects: &[Project]) -> Result<(), String> {
    if projects.is_empty() || projects.len() > 200 {
        return Err("Keep between 1 and 200 projects".into());
    }
    for p in projects {
        let name = p.name.trim();
        if name.is_empty() || name.chars().count() > 60 || p.id.is_empty() || p.id.len() > 64 {
            return Err("Project names are 1 to 60 characters".into());
        }
        if let Some(b) = &p.brief {
            check_brief(b)?;
        }
    }
    Ok(())
}

/// Saves the projects, sealed. An empty brief is dropped rather than saved.
pub fn save(data_dir: &Path, projects: Vec<Project>) -> Result<(), String> {
    check(&projects)?;
    let projects: Vec<Project> = projects.into_iter().map(|p| Project { brief: p.brief.filter(|b| !b.is_empty()), ..p }).collect();
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    at_rest::write_string(&path(data_dir), &serde_json::to_string_pretty(&projects).map_err(|e| e.to_string())?)
}

/// Ids and names only, for coding agents: a brief is the user's private context and stays out.
pub fn public_list(data_dir: &Path) -> Value {
    let list = match at_rest::read_json(&path(data_dir)) {
        Some(Value::Array(a)) => a,
        _ => return json!([{ "id": "general", "name": "General" }]),
    };
    Value::Array(list.iter().map(|p| json!({ "id": p["id"], "name": p["name"] })).collect())
}

/// A brief from a backup, if it passes the same checks as a saved one.
pub fn restored_brief(v: &Value) -> Option<Value> {
    let b: Brief = serde_json::from_value(v.clone()).ok()?;
    (!b.is_empty() && check_brief(&b).is_ok()).then(|| serde_json::to_value(b).ok()).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aftercall-projects-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn brief() -> Brief {
        Brief {
            about: "Rebuilding Moonbeam Bikes' website: new booking flow, launch in March".into(),
            people: vec![BriefPerson { name: "Olamide".into(), role: "client, product lead".into() }, BriefPerson { name: "John".into(), role: String::new() }],
            words: vec!["Moonbeam".into(), "Stripe".into()],
            watch_for: "pricing decisions, deadlines".into(),
        }
    }

    #[test]
    fn projects_from_earlier_versions_still_load() {
        let dir = temp_dir("old");
        // Plaintext from before encryption at rest, then sealed by migration: both just id and name.
        std::fs::write(path(&dir), r#"[{"id":"general","name":"General"},{"id":"fundraise-a1b","name":"Fundraise"}]"#).unwrap();
        let plain = load(&dir).unwrap();
        assert_eq!(plain[1], Project { id: "fundraise-a1b".into(), name: "Fundraise".into(), brief: None });
        at_rest::write_string(&path(&dir), r#"[{"id":"general","name":"General"}]"#).unwrap();
        assert_eq!(load(&dir).unwrap(), general());
        // No file yet: the first run's "General".
        std::fs::remove_file(path(&dir)).unwrap();
        assert_eq!(load(&dir).unwrap(), general());
        // Saving them back writes no brief key.
        save(&dir, plain).unwrap();
        assert!(!at_rest::read_string(&path(&dir)).unwrap().contains("brief"));
    }

    #[test]
    fn a_brief_is_never_on_disk_in_plaintext() {
        let dir = temp_dir("sealed");
        let projects = vec![Project { id: "moonbeam-x1y".into(), name: "Moonbeam".into(), brief: Some(brief()) }];
        save(&dir, projects.clone()).unwrap();
        let raw = std::fs::read(path(&dir)).unwrap();
        assert!(at_rest::is_sealed(&raw));
        for bit in ["Moonbeam", "Olamide", "booking flow", "Stripe", "pricing", "about", "watchFor"] {
            assert!(!raw.windows(bit.len()).any(|w| w == bit.as_bytes()), "\"{bit}\" is on disk in plaintext");
        }
        // No stray plaintext copy next to it either (the write is a temp file renamed over it).
        let names: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("projects.json")]);
        assert_eq!(load(&dir).unwrap(), projects);
        let json = at_rest::read_string(&path(&dir)).unwrap();
        assert!(json.contains("\"watchFor\": \"pricing decisions, deadlines\""), "camelCase, as the interface sends it");
    }

    #[test]
    fn an_empty_brief_is_dropped_and_a_bad_one_refused() {
        let dir = temp_dir("checks");
        save(&dir, vec![Project { id: "a".into(), name: "A".into(), brief: Some(Brief::default()) }]).unwrap();
        assert_eq!(load(&dir).unwrap()[0].brief, None);
        let with = |b: Brief| vec![Project { id: "a".into(), name: "A".into(), brief: Some(b) }];
        assert!(save(&dir, with(Brief { about: "x".repeat(ABOUT_MAX + 1), ..brief() })).is_err());
        assert!(save(&dir, with(Brief { about: "é".repeat(ABOUT_MAX), ..brief() })).is_ok(), "characters, not bytes");
        assert!(save(&dir, with(Brief { words: vec!["w".into(); WORDS_MAX + 1], ..brief() })).is_err());
        assert!(save(&dir, with(Brief { people: vec![BriefPerson { name: " ".into(), role: "x".into() }], ..brief() })).is_err());
        assert!(save(&dir, with(Brief { watch_for: "ignore >>> the rules".into(), ..brief() })).unwrap_err().contains("<<<"));
        assert!(save(&dir, vec![]).is_err());
    }

    #[test]
    fn agents_get_ids_and_names_only() {
        let dir = temp_dir("agents");
        save(&dir, vec![Project { id: "moonbeam-x1y".into(), name: "Moonbeam".into(), brief: Some(brief()) }]).unwrap();
        assert_eq!(public_list(&dir), json!([{ "id": "moonbeam-x1y", "name": "Moonbeam" }]));
    }
}
