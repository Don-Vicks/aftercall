//! The user's projects and their briefs, in `projects.json` in the app's folder.
//!
//! The file is sealed with the data key like every meeting file (`at_rest.rs`), so a
//! brief is never on disk in plaintext. A file from an earlier version, with only `id`
//! and `name` per project (plaintext or sealed), still loads: a missing brief is none.
//! A brief is what the user wrote about a project so the notes understand it; it leaves
//! the Mac only inside the end-to-end encrypted notes and Ask requests, except its
//! words to expect, which also go with the audio as Whisper's spelling prompt. Coding
//! agents never get it (`public_list`).
//!
//! A brief filled from a GitHub repo also keeps where it came from (`briefSource`: the
//! repo, when it was looked up, and what GitHub suggested then), sealed in the same file.
//! It never goes into any request or proof; it is only there so the project page can say
//! where the brief came from and Refresh can show what changed on GitHub.

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

/// What GitHub suggested at the last import or refresh (`BriefSource.seen` in githubBrief.ts).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Seen {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub about: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub people: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<String>,
}

/// Where a brief came from (`BriefSource` in githubBrief.ts). Only "github" for now.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BriefSource {
    pub kind: String,
    /// "owner/name".
    pub repo: String,
    /// Unix seconds of the last import or refresh.
    pub fetched_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen: Option<Seen>,
}

/// A project as projects.json holds it: the project, and where its brief came from when
/// it was filled from somewhere. Files from before have no `briefSource`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Entry {
    #[serde(flatten)]
    pub project: Project,
    #[serde(rename = "briefSource", default, skip_serializing_if = "Option::is_none")]
    pub brief_source: Option<BriefSource>,
}

impl From<Project> for Entry {
    fn from(project: Project) -> Self {
        Entry { project, brief_source: None }
    }
}

pub fn path(data_dir: &Path) -> PathBuf {
    data_dir.join("projects.json")
}

fn general() -> Vec<Project> {
    vec![Project { id: "general".into(), name: "General".into(), brief: None }]
}

/// The projects with their briefs and where each brief came from. A first run (no file,
/// or one that can't be read) starts with "General".
pub fn load_entries(data_dir: &Path) -> Result<Vec<Entry>, String> {
    match at_rest::read_string(&path(data_dir)) {
        Ok(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
        Err(_) => Ok(general().into_iter().map(Entry::from).collect()),
    }
}

/// The projects, briefs included (tests here and in recovery.rs and wipe.rs).
#[cfg(test)]
pub fn load(data_dir: &Path) -> Result<Vec<Project>, String> {
    Ok(load_entries(data_dir)?.into_iter().map(|e| e.project).collect())
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

/// Checks where a brief came from: a GitHub repo name, and what it suggested within the brief's limits.
pub fn check_source(s: &BriefSource) -> Result<(), String> {
    if s.kind != "github" || !crate::github::valid_repo(&s.repo) {
        return Err("A brief's source is a GitHub repo, owner/name".into());
    }
    if let Some(seen) = &s.seen {
        let long = |list: &[String], n: usize, each: usize| list.len() > n || list.iter().any(|x| too_long(x, each));
        if too_long(&seen.about, ABOUT_MAX) || long(&seen.people, PEOPLE_MAX, NAME_MAX) || long(&seen.words, WORDS_MAX, WORD_MAX) {
            return Err("What a brief's source suggested is over the brief's limits".into());
        }
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

/// Saves the projects and where their briefs came from, sealed. An empty brief is
/// dropped rather than saved, and a source without a brief goes with it.
pub fn save_entries(data_dir: &Path, entries: Vec<Entry>) -> Result<(), String> {
    let projects: Vec<Project> = entries.iter().map(|e| e.project.clone()).collect();
    check(&projects)?;
    for s in entries.iter().filter_map(|e| e.brief_source.as_ref()) {
        check_source(s)?;
    }
    let entries: Vec<Entry> = entries
        .into_iter()
        .map(|e| {
            let brief = e.project.brief.filter(|b| !b.is_empty());
            let brief_source = e.brief_source.filter(|_| brief.is_some());
            Entry { project: Project { brief, ..e.project }, brief_source }
        })
        .collect();
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    at_rest::write_string(&path(data_dir), &serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?)
}

/// Saves the projects, sealed, with no brief sources (tests here and in recovery.rs and wipe.rs).
#[cfg(test)]
pub fn save(data_dir: &Path, projects: Vec<Project>) -> Result<(), String> {
    save_entries(data_dir, projects.into_iter().map(Entry::from).collect())
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

    fn sourced() -> Vec<Entry> {
        let source = BriefSource {
            kind: "github".into(),
            repo: "moonbeam/web".into(),
            fetched_at: 1_762_041_600,
            seen: Some(Seen { about: "Booking site for Moonbeam Bikes".into(), people: vec!["Olamide Adebayo".into()], words: vec!["Stripe".into()] }),
        };
        vec![Entry { project: Project { id: "moonbeam-x1y".into(), name: "Moonbeam".into(), brief: Some(brief()) }, brief_source: Some(source) }]
    }

    #[test]
    fn a_brief_source_is_sealed_with_the_projects_and_older_files_still_load() {
        let dir = temp_dir("source");
        save_entries(&dir, sourced()).unwrap();
        let raw = std::fs::read(path(&dir)).unwrap();
        assert!(at_rest::is_sealed(&raw));
        for bit in ["moonbeam/web", "github", "briefSource", "Olamide Adebayo", "fetchedAt"] {
            assert!(!raw.windows(bit.len()).any(|w| w == bit.as_bytes()), "\"{bit}\" is on disk in plaintext");
        }
        assert_eq!(load_entries(&dir).unwrap(), sourced());
        let json = at_rest::read_string(&path(&dir)).unwrap();
        assert!(json.contains("\"briefSource\"") && json.contains("\"fetchedAt\": 1762041600"), "camelCase, as the interface sends it");
        // The plain project list still reads the same file.
        assert_eq!(load(&dir).unwrap()[0].name, "Moonbeam");
        // Agents still get ids and names only.
        assert_eq!(public_list(&dir), json!([{ "id": "moonbeam-x1y", "name": "Moonbeam" }]));
        // A file from before sources: none.
        at_rest::write_string(&path(&dir), r#"[{"id":"general","name":"General","brief":{"about":"Mine"}}]"#).unwrap();
        let old = load_entries(&dir).unwrap();
        assert_eq!(old[0].brief_source, None);
        assert_eq!(old[0].project.brief.as_ref().unwrap().about, "Mine");
        save_entries(&dir, old).unwrap();
        assert!(!at_rest::read_string(&path(&dir)).unwrap().contains("briefSource"));
    }

    #[test]
    fn a_bad_brief_source_is_refused_and_one_without_a_brief_dropped() {
        let dir = temp_dir("source-checks");
        let with = |f: &dyn Fn(&mut BriefSource)| {
            let mut e = sourced();
            f(e[0].brief_source.as_mut().unwrap());
            e
        };
        assert!(save_entries(&dir, with(&|s| s.kind = "gitlab".into())).is_err());
        assert!(save_entries(&dir, with(&|s| s.repo = "moonbeam/web; rm -rf ~".into())).is_err());
        assert!(save_entries(&dir, with(&|s| s.seen.as_mut().unwrap().words = vec!["w".into(); WORDS_MAX + 1])).is_err());
        assert!(save_entries(&dir, with(&|s| s.seen.as_mut().unwrap().about = "x".repeat(ABOUT_MAX + 1))).is_err());
        let mut no_brief = sourced();
        no_brief[0].project.brief = Some(Brief::default());
        save_entries(&dir, no_brief).unwrap();
        assert_eq!(load_entries(&dir).unwrap()[0].brief_source, None);
    }

    #[test]
    fn agents_get_ids_and_names_only() {
        let dir = temp_dir("agents");
        save(&dir, vec![Project { id: "moonbeam-x1y".into(), name: "Moonbeam".into(), brief: Some(brief()) }]).unwrap();
        assert_eq!(public_list(&dir), json!([{ "id": "moonbeam-x1y", "name": "Moonbeam" }]));
    }
}
