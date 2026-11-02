//! "Fill from GitHub" for a project brief, without AI: a repo's description, topics,
//! README, contributors, CODEOWNERS and package files, which the interface turns into
//! suggestions you review (`briefFromGithub`, packages/core/src/notes/githubBrief.ts).
//!
//! The GitHub CLI (`gh`) is preferred. It is looked for like `claude` is (agents.rs):
//! the folders it is usually installed in, then the login shell. It runs with fixed
//! arguments, no shell, only `gh api <read-only path>`, and uses the user's own GitHub
//! sign-in, so private repos work and Aftercall never sees or stores a token. Without
//! `gh`, or when it isn't signed in, GitHub's public REST API is asked without signing
//! in: public repos only, 60 requests an hour per IP address. A lookup costs about 6
//! requests, plus up to 5 for contributors' names.
//!
//! What GitHub learns: which repo was looked up, from this IP address (and, through
//! `gh`, by which GitHub account). Nothing from meetings or briefs is sent.

use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::agents;

/// How much of the README the interface gets (it only reads the start and the title).
const README_MAX: usize = 100_000;
/// CODEOWNERS, package.json and Cargo.toml are small; anything longer is cut.
const FILE_MAX: usize = 64_000;
/// The most read from one answer, in bytes.
const BODY_MAX: usize = 1_048_576;
/// Contributors asked for; bots are dropped later, and at most 8 people are suggested.
const CONTRIBUTORS: usize = 12;
/// Profile names looked up (one request each) for the top contributors.
const NAMES: usize = 8;
/// Without `gh`, fewer: each one spends one of the 60 an hour.
const NAMES_WEB: usize = 5;
/// How long one `gh` call may take.
const GH_LIMIT: Duration = Duration::from_secs(20);

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Contributor {
    pub login: String,
    pub name: String,
    pub contributions: u64,
    pub bot: bool,
}

/// What the interface gets (`GithubRepoDetails` in githubBrief.ts).
#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoDetails {
    pub repo: String,
    /// "gh" or "web".
    pub via: String,
    pub name: String,
    pub description: String,
    pub homepage: String,
    pub topics: Vec<String>,
    pub language: String,
    pub private: bool,
    pub readme: String,
    pub contributors: Vec<Contributor>,
    pub codeowners: String,
    pub package_json: String,
    pub cargo_toml: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Fail {
    /// No such repo, or not one this sign-in can see.
    NotFound,
    /// `gh` is installed but not signed in: the public API is tried instead.
    SignedOut,
    /// GitHub's rate limit; minutes until it resets, when GitHub said.
    Limited(Option<u64>),
    Offline,
    Other(String),
}

/// One GET: the body, `None` for a 404, or why it failed.
pub type Got = Result<Option<String>, Fail>;

/// "owner/name" as GitHub allows it. Checked before anything runs.
pub fn valid_repo(s: &str) -> bool {
    let Some((owner, name)) = s.split_once('/') else { return false };
    let owner_ok = (1..=39).contains(&owner.len()) && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !owner.starts_with('-');
    let name_ok = (1..=100).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) && name != "." && name != "..";
    owner_ok && name_ok
}

/// At most `max` characters, cut on a character boundary.
fn cap(s: String, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => s[..i].to_string(),
        None => s,
    }
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

/// The repo's own fields from `GET /repos/{owner}/{name}`. `full_name` follows renames.
pub fn details_from_meta(meta: &Value, via: &str) -> RepoDetails {
    RepoDetails {
        repo: text(&meta["full_name"]),
        via: via.into(),
        name: text(&meta["name"]),
        description: cap(text(&meta["description"]), 1_000),
        homepage: cap(text(&meta["homepage"]), 300),
        topics: meta["topics"].as_array().map(|a| a.iter().filter_map(Value::as_str).take(30).map(String::from).collect()).unwrap_or_default(),
        language: text(&meta["language"]),
        private: meta["private"].as_bool().unwrap_or(false),
        ..Default::default()
    }
}

/// Contributors from `GET /repos/{o}/{r}/contributors`: logins, commit counts, bots marked.
pub fn contributors_from(json: &str) -> Vec<Contributor> {
    let list: Vec<Value> = serde_json::from_str(json).unwrap_or_default();
    list.iter()
        .filter_map(|c| {
            let login = c["login"].as_str()?.to_string();
            let bot = c["type"].as_str() == Some("Bot") || login.ends_with("[bot]");
            Some(Contributor { login, name: String::new(), contributions: c["contributions"].as_u64().unwrap_or(0), bot })
        })
        .take(CONTRIBUTORS)
        .collect()
}

/// The root folder's files and folders, from `GET /repos/{o}/{r}/contents/`.
fn listing(json: Option<&str>) -> (Vec<String>, Vec<String>) {
    let list: Vec<Value> = json.and_then(|j| serde_json::from_str(j).ok()).unwrap_or_default();
    let names = |kind: &str| list.iter().filter(|e| e["type"].as_str() == Some(kind)).filter_map(|e| e["name"].as_str().map(String::from)).collect();
    (names("file"), names("dir"))
}

/// A part that may be missing: a 404 or an odd answer is "none"; running out of
/// requests, being offline or signed out stops the lookup.
fn optional(got: Got) -> Result<Option<String>, Fail> {
    match got {
        Ok(v) => Ok(v),
        Err(Fail::Other(_)) => Ok(None),
        Err(e) => Err(e),
    }
}

/// How a lookup asks GitHub: through `gh`, the public API, or (in tests) a fake.
pub trait Fetch {
    /// One GET of an API path; `raw` asks for a file's text.
    fn get(&self, path: String, raw: bool) -> impl Future<Output = Got> + Send;
    /// Profile names for some logins (those without one are left out).
    fn names(&self, logins: Vec<String>) -> impl Future<Output = HashMap<String, String>> + Send;
}

/// Everything a brief can use from one repo.
pub async fn collect(repo: &str, via: &str, f: &(impl Fetch + Sync)) -> Result<RepoDetails, Fail> {
    let get = |path: String, raw: bool| f.get(path, raw);
    let meta = get(format!("repos/{repo}"), false).await?.ok_or(Fail::NotFound)?;
    let meta: Value = serde_json::from_str(&meta).map_err(|_| Fail::Other("GitHub's answer couldn't be read.".into()))?;
    let mut d = details_from_meta(&meta, via);
    if !valid_repo(&d.repo) {
        d.repo = repo.to_string();
    }
    let full = d.repo.clone();

    d.readme = optional(get(format!("repos/{full}/readme"), true).await)?.map(|r| cap(r, README_MAX)).unwrap_or_default();
    d.contributors = optional(get(format!("repos/{full}/contributors?per_page={CONTRIBUTORS}"), false).await)?.map(|j| contributors_from(&j)).unwrap_or_default();

    let root = optional(get(format!("repos/{full}/contents/"), false).await)?;
    let (files, dirs) = listing(root.as_deref());
    let has_file = |n: &str| files.iter().any(|f| f == n);
    let has_dir = |n: &str| dirs.iter().any(|f| f == n);
    // CODEOWNERS: .github/, then the root, then docs/; the first one found counts, as on GitHub.
    for (path, there) in [(".github/CODEOWNERS", has_dir(".github")), ("CODEOWNERS", has_file("CODEOWNERS")), ("docs/CODEOWNERS", has_dir("docs"))] {
        if !there {
            continue;
        }
        if let Some(t) = optional(get(format!("repos/{full}/contents/{path}"), true).await)? {
            d.codeowners = cap(t, FILE_MAX);
            break;
        }
    }
    if has_file("package.json") {
        d.package_json = optional(get(format!("repos/{full}/contents/package.json"), true).await)?.map(|t| cap(t, FILE_MAX)).unwrap_or_default();
    }
    if has_file("Cargo.toml") {
        d.cargo_toml = optional(get(format!("repos/{full}/contents/Cargo.toml"), true).await)?.map(|t| cap(t, FILE_MAX)).unwrap_or_default();
    }

    let logins: Vec<String> = d.contributors.iter().filter(|c| !c.bot).map(|c| c.login.clone()).collect();
    if !logins.is_empty() {
        let found = f.names(logins).await;
        for c in &mut d.contributors {
            if let Some(n) = found.get(&c.login) {
                c.name = cap(n.trim().to_string(), 100);
            }
        }
    }
    Ok(d)
}

// ---------- through gh ----------

/// Where `gh` is: the usual folders, then the login shell.
pub fn find_gh(home: &Path) -> Option<PathBuf> {
    agents::find_tool("gh", &agents::tool_dirs("gh", home), &login_shell_lookup).into_iter().next()
}

/// Asks the user's login shell where `name` is, as Terminal would find it.
fn login_shell_lookup(name: &str) -> Option<String> {
    let out = run(Command::new("/bin/zsh").args(["-lc", &format!("command -v {name}")]), Duration::from_secs(5)).ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Runs a command with no input, stopping it after `limit`.
fn run(cmd: &mut Command, limit: Duration) -> Result<Output, String> {
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    // Output can be larger than a pipe holds (a README), so read it while waiting.
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(s) = stdout.as_mut() {
            use std::io::Read;
            let _ = s.take(BODY_MAX as u64).read_to_end(&mut buf);
        }
        buf
    });
    let err_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(s) = stderr.as_mut() {
            use std::io::Read;
            let _ = s.take(16_384).read_to_end(&mut buf);
        }
        buf
    });
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("it didn't finish within {} seconds", limit.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    Ok(Output { status, stdout: out_reader.join().unwrap_or_default(), stderr: err_reader.join().unwrap_or_default() })
}

/// The fixed arguments of one read: `gh api <path> -H "Accept: …"`. Never a shell.
pub fn gh_args(path: &str, raw: bool) -> Vec<String> {
    let accept = if raw { "application/vnd.github.raw+json" } else { "application/vnd.github+json" };
    vec!["api".into(), path.into(), "-H".into(), format!("Accept: {accept}")]
}

/// What a failed `gh api` call means, from its exit code and what it printed.
pub fn gh_failure(code: Option<i32>, stderr: &str) -> Got {
    let s = stderr.to_lowercase();
    if s.contains("http 404") || (s.contains("not found") && !s.contains("command not found")) {
        return Ok(None);
    }
    if code == Some(4) || s.contains("gh auth login") || s.contains("http 401") || s.contains("bad credentials") {
        return Err(Fail::SignedOut);
    }
    if s.contains("rate limit") || s.contains("http 429") {
        return Err(Fail::Limited(None));
    }
    if s.contains("error connecting") || s.contains("no such host") || s.contains("dial tcp") || s.contains("timeout") || s.contains("network is unreachable") {
        return Err(Fail::Offline);
    }
    let line = stderr.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("no message");
    Err(Fail::Other(format!("GitHub CLI said: {}", cap(line.to_string(), 200))))
}

fn gh_get(gh: &Path, path: &str, raw: bool) -> Got {
    let out = run(
        Command::new(gh).args(gh_args(path, raw)).env("GH_PROMPT_DISABLED", "1").env("GH_NO_UPDATE_NOTIFIER", "1").env("NO_COLOR", "1"),
        GH_LIMIT,
    )
    .map_err(|e| Fail::Other(format!("GitHub CLI didn't answer: {e}")))?;
    if out.status.success() {
        return Ok(Some(String::from_utf8_lossy(&out.stdout).into_owned()));
    }
    gh_failure(out.status.code(), &String::from_utf8_lossy(&out.stderr))
}

/// Profile names through `gh`, a few at a time.
fn gh_names(gh: &Path, logins: &[String]) -> HashMap<String, String> {
    std::thread::scope(|s| {
        let calls: Vec<_> = logins
            .iter()
            .take(NAMES)
            .filter(|l| l.len() <= 39 && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
            .map(|login| s.spawn(move || (login.clone(), gh_get(gh, &format!("users/{login}"), false))))
            .collect();
        calls
            .into_iter()
            .filter_map(|c| c.join().ok())
            .filter_map(|(login, got)| {
                let v: Value = serde_json::from_str(&got.ok()??).ok()?;
                let name = v["name"].as_str()?.trim().to_string();
                (!name.is_empty()).then_some((login, name))
            })
            .collect()
    })
}

struct Gh(PathBuf);

impl Fetch for Gh {
    fn get(&self, path: String, raw: bool) -> impl Future<Output = Got> + Send {
        let gh = self.0.clone();
        async move { tauri::async_runtime::spawn_blocking(move || gh_get(&gh, &path, raw)).await.map_err(|e| Fail::Other(e.to_string()))? }
    }
    fn names(&self, logins: Vec<String>) -> impl Future<Output = HashMap<String, String>> + Send {
        let gh = self.0.clone();
        async move { tauri::async_runtime::spawn_blocking(move || gh_names(&gh, &logins)).await.unwrap_or_default() }
    }
}

// ---------- GitHub's public API, signed out ----------

/// What a REST answer's status means; `None` when it succeeded. `reset` is GitHub's
/// `x-ratelimit-reset` (unix seconds).
pub fn web_failure(status: u16, remaining: Option<&str>, reset: Option<&str>, now: u64) -> Option<Got> {
    match status {
        200..=299 => None,
        404 => Some(Ok(None)),
        403 | 429 if status == 429 || remaining == Some("0") => {
            let minutes = reset.and_then(|r| r.trim().parse::<u64>().ok()).map(|r| r.saturating_sub(now).div_ceil(60).max(1));
            Some(Err(Fail::Limited(minutes)))
        }
        _ => Some(Err(Fail::Other(format!("GitHub answered HTTP {status}.")))),
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn web_client() -> Result<reqwest::Client, Fail> {
    reqwest::Client::builder()
        .user_agent("Aftercall (project brief from a GitHub repo)")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| Fail::Other(e.to_string()))
}

async fn web_get(client: &reqwest::Client, path: &str, raw: bool) -> Got {
    let accept = if raw { "application/vnd.github.raw+json" } else { "application/vnd.github+json" };
    let res = client
        .get(format!("https://api.github.com/{path}"))
        .header("Accept", accept)
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| if e.is_connect() || e.is_timeout() { Fail::Offline } else { Fail::Other(format!("GitHub couldn't be asked: {e}")) })?;
    let header = |n: &str| res.headers().get(n).and_then(|v| v.to_str().ok()).map(String::from);
    let (remaining, reset) = (header("x-ratelimit-remaining"), header("x-ratelimit-reset"));
    if let Some(f) = web_failure(res.status().as_u16(), remaining.as_deref(), reset.as_deref(), now_secs()) {
        return f;
    }
    let mut res = res;
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| Fail::Offline)? {
        body.extend_from_slice(&chunk);
        if body.len() >= BODY_MAX {
            body.truncate(BODY_MAX);
            break;
        }
    }
    Ok(Some(String::from_utf8_lossy(&body).into_owned()))
}

struct Web(reqwest::Client);

impl Fetch for Web {
    fn get(&self, path: String, raw: bool) -> impl Future<Output = Got> + Send {
        let client = self.0.clone();
        async move { web_get(&client, &path, raw).await }
    }
    fn names(&self, logins: Vec<String>) -> impl Future<Output = HashMap<String, String>> + Send {
        let client = self.0.clone();
        async move {
            let mut out = HashMap::new();
            for login in logins.into_iter().take(NAMES_WEB) {
                if !login.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                    continue;
                }
                let Ok(Some(json)) = web_get(&client, &format!("users/{login}"), false).await else { break };
                if let Some(name) = serde_json::from_str::<Value>(&json).ok().and_then(|v| v["name"].as_str().map(|s| s.trim().to_string())).filter(|n| !n.is_empty()) {
                    out.insert(login, name);
                }
            }
            out
        }
    }
}

// ---------- the command ----------

/// A failure in plain words. `with_gh`: the lookup went through the GitHub CLI.
pub fn message(f: &Fail, with_gh: bool) -> String {
    match f {
        Fail::NotFound if with_gh => "GitHub has no repo by that name, or your GitHub account can't see it.".into(),
        Fail::NotFound => "GitHub has no public repo by that name. If it's private, install GitHub CLI and run “gh auth login”, then try again.".into(),
        Fail::Limited(Some(m)) => format!(
            "GitHub's limit for lookups without signing in is used up. Try again in {m} {}, or install GitHub CLI and sign in.",
            if *m == 1 { "minute" } else { "minutes" }
        ),
        Fail::Limited(None) => "GitHub's rate limit is used up for now. Try again in a while.".into(),
        Fail::Offline => "Couldn't reach GitHub. Check your connection, then try again.".into(),
        Fail::SignedOut => "GitHub CLI isn't signed in. Run “gh auth login”, then try again.".into(),
        Fail::Other(s) => s.clone(),
    }
}

/// Looks a repo up: through `gh` when it's installed and signed in, otherwise through
/// the public API. `repo` is "owner/name" (the interface parses pasted URLs).
pub async fn lookup(home: PathBuf, repo: String) -> Result<RepoDetails, String> {
    let repo = repo.trim().to_string();
    if !valid_repo(&repo) {
        return Err("That isn't a GitHub repo. Paste its address, like github.com/owner/name.".into());
    }
    let gh = tauri::async_runtime::spawn_blocking(move || find_gh(&home)).await.ok().flatten();
    if let Some(gh) = gh {
        match collect(&repo, "gh", &Gh(gh)).await {
            Ok(d) => return Ok(d),
            // Not signed in: the public API can still see a public repo.
            Err(Fail::SignedOut) => {}
            Err(e) => return Err(message(&e, true)),
        }
    }
    let web = Web(web_client().map_err(|e| message(&e, false))?);
    collect(&repo, "web", &web).await.map_err(|e| message(&e, false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;

    #[test]
    fn only_a_real_repo_name_gets_as_far_as_gh_or_the_network() {
        for ok in ["cli/cli", "near/near-api-js", "o/repo.name_x", "a-b/c"] {
            assert!(valid_repo(ok), "{ok}");
        }
        for bad in ["", "cli", "cli/cli/x", "-a/b", "a/..", "a/.", "a/b c", "a/b;ls", "a/$(x)", "a/b\n", &format!("{}/x", "a".repeat(40)), &format!("a/{}", "x".repeat(101)), "../etc"] {
            assert!(!valid_repo(bad), "{bad:?}");
        }
    }

    #[test]
    fn gh_runs_one_read_with_fixed_arguments() {
        assert_eq!(gh_args("repos/cli/cli", false), ["api", "repos/cli/cli", "-H", "Accept: application/vnd.github+json"]);
        assert_eq!(gh_args("repos/cli/cli/readme", true), ["api", "repos/cli/cli/readme", "-H", "Accept: application/vnd.github.raw+json"]);
        assert_eq!(agents::tool_dirs("gh", Path::new("/Users/ada")), ["/Users/ada/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    }

    #[test]
    fn what_gh_says_when_it_fails() {
        assert_eq!(gh_failure(Some(1), "gh: Not Found (HTTP 404)\n"), Ok(None));
        assert_eq!(gh_failure(Some(4), "To get started with GitHub CLI, please run:  gh auth login\n"), Err(Fail::SignedOut));
        assert_eq!(gh_failure(Some(1), "gh: Bad credentials (HTTP 401)"), Err(Fail::SignedOut));
        assert_eq!(gh_failure(Some(1), "gh: API rate limit exceeded for user ID 1. (HTTP 403)"), Err(Fail::Limited(None)));
        assert_eq!(gh_failure(Some(1), "error connecting to api.github.com"), Err(Fail::Offline));
        assert_eq!(gh_failure(Some(1), "\n  gh: Something odd (HTTP 500)\n"), Err(Fail::Other("GitHub CLI said: gh: Something odd (HTTP 500)".into())));
    }

    #[test]
    fn what_the_public_api_says_when_it_fails() {
        assert_eq!(web_failure(200, Some("59"), None, 0), None);
        assert_eq!(web_failure(404, Some("58"), None, 0), Some(Ok(None)));
        assert_eq!(web_failure(403, Some("0"), Some("1700000600"), 1_700_000_000), Some(Err(Fail::Limited(Some(10)))));
        assert_eq!(web_failure(429, None, Some("1700000001"), 1_700_000_000), Some(Err(Fail::Limited(Some(1)))));
        assert_eq!(web_failure(429, None, None, 0), Some(Err(Fail::Limited(None))));
        assert_eq!(web_failure(403, Some("12"), None, 0), Some(Err(Fail::Other("GitHub answered HTTP 403.".into()))));
        assert_eq!(web_failure(500, None, None, 0), Some(Err(Fail::Other("GitHub answered HTTP 500.".into()))));
        assert!(message(&Fail::Limited(Some(10)), false).contains("Try again in 10 minutes"));
        assert!(message(&Fail::NotFound, false).contains("gh auth login"));
        assert!(message(&Fail::NotFound, true).contains("your GitHub account can't see it"));
        assert!(message(&Fail::Offline, false).starts_with("Couldn't reach GitHub"));
    }

    /// A fake GitHub: API paths to answers (missing = 404); every path asked is recorded.
    struct Fake {
        answers: HashMap<String, Got>,
        asked: Mutex<Vec<String>>,
        names: HashMap<String, String>,
        /// The logins `names` must be asked for; `None`: it must not be asked.
        expect_logins: Option<Vec<String>>,
        /// Every path but these answers with this.
        otherwise: Option<(Vec<String>, Got)>,
    }

    fn fake(answers: Vec<(&str, Got)>) -> Fake {
        Fake { answers: answers.into_iter().map(|(p, g)| (p.to_string(), g)).collect(), asked: Mutex::new(Vec::new()), names: HashMap::new(), expect_logins: None, otherwise: None }
    }

    impl Fetch for Fake {
        fn get(&self, path: String, _raw: bool) -> impl Future<Output = Got> + Send {
            self.asked.lock().unwrap().push(path.clone());
            let got = match &self.otherwise {
                Some((except, got)) if !except.contains(&path) => got.clone(),
                _ => self.answers.get(&path).cloned().unwrap_or(Ok(None)),
            };
            async move { got }
        }
        fn names(&self, logins: Vec<String>) -> impl Future<Output = HashMap<String, String>> + Send {
            assert_eq!(Some(&logins), self.expect_logins.as_ref(), "bots aren't looked up, and nobody is without contributors");
            let names = self.names.clone();
            async move { names }
        }
    }

    fn meta() -> String {
        json!({ "full_name": "moonbeam/web", "name": "web", "description": "Booking site", "homepage": null, "topics": ["booking", "stripe"], "language": "TypeScript", "private": true }).to_string()
    }

    #[tokio::test]
    async fn a_lookup_reads_the_repo_readme_contributors_codeowners_and_package_files() {
        let contributors = json!([
            { "login": "olamide-a", "type": "User", "contributions": 212 },
            { "login": "dependabot[bot]", "type": "Bot", "contributions": 140 },
            { "login": "jkim", "type": "User", "contributions": 87 }
        ]);
        let root = json!([{ "name": ".github", "type": "dir" }, { "name": "CODEOWNERS", "type": "file" }, { "name": "package.json", "type": "file" }, { "name": "README.md", "type": "file" }]);
        let mut f = fake(vec![
            ("repos/moonbeam/web", Ok(Some(meta()))),
            ("repos/moonbeam/web/readme", Ok(Some("# Moonbeam\n\nText".into()))),
            ("repos/moonbeam/web/contributors?per_page=12", Ok(Some(contributors.to_string()))),
            ("repos/moonbeam/web/contents/", Ok(Some(root.to_string()))),
            // .github/ has no CODEOWNERS (404), so the root's counts.
            ("repos/moonbeam/web/contents/CODEOWNERS", Ok(Some("* @olamide-a".into()))),
            ("repos/moonbeam/web/contents/package.json", Ok(Some(r#"{"name":"@moonbeam/web"}"#.into()))),
        ]);
        f.expect_logins = Some(vec!["olamide-a".into(), "jkim".into()]);
        f.names = HashMap::from([("olamide-a".to_string(), " Olamide Adebayo ".to_string())]);
        let d = collect("moonbeam/web", "gh", &f).await.unwrap();
        assert_eq!(d.repo, "moonbeam/web");
        assert_eq!((d.via.as_str(), d.description.as_str(), d.homepage.as_str(), d.private), ("gh", "Booking site", "", true));
        assert_eq!(d.topics, ["booking", "stripe"]);
        assert_eq!(d.readme, "# Moonbeam\n\nText");
        assert_eq!(d.codeowners, "* @olamide-a");
        assert_eq!(d.package_json, r#"{"name":"@moonbeam/web"}"#);
        assert_eq!(d.cargo_toml, "", "not in the root listing, so not asked for");
        assert_eq!(
            d.contributors,
            [
                Contributor { login: "olamide-a".into(), name: "Olamide Adebayo".into(), contributions: 212, bot: false },
                Contributor { login: "dependabot[bot]".into(), name: String::new(), contributions: 140, bot: true },
                Contributor { login: "jkim".into(), name: String::new(), contributions: 87, bot: false },
            ]
        );
        assert_eq!(
            *f.asked.lock().unwrap(),
            [
                "repos/moonbeam/web",
                "repos/moonbeam/web/readme",
                "repos/moonbeam/web/contributors?per_page=12",
                "repos/moonbeam/web/contents/",
                "repos/moonbeam/web/contents/.github/CODEOWNERS",
                "repos/moonbeam/web/contents/CODEOWNERS",
                "repos/moonbeam/web/contents/package.json",
            ],
            "read-only paths of this one repo, nothing else"
        );
        // The interface gets camelCase, as githubBrief.ts expects.
        let v = serde_json::to_value(&d).unwrap();
        assert!(v.get("packageJson").is_some() && v.get("cargoToml").is_some());
    }

    #[tokio::test]
    async fn a_renamed_repo_is_followed_and_missing_parts_are_just_empty() {
        let renamed = json!({ "full_name": "moonbeam/booking", "name": "booking", "description": null, "topics": [] }).to_string();
        let f = fake(vec![
            ("repos/moonbeam/web", Ok(Some(renamed))),
            // A repo too big to list contributors for: GitHub refuses, and that part is empty.
            ("repos/moonbeam/booking/contributors?per_page=12", Err(Fail::Other("GitHub answered HTTP 403.".into()))),
        ]);
        let d = collect("moonbeam/web", "web", &f).await.unwrap();
        assert_eq!((d.repo.as_str(), d.name.as_str(), d.description.as_str(), d.readme.as_str()), ("moonbeam/booking", "booking", "", ""));
        assert!(d.contributors.is_empty() && d.codeowners.is_empty() && d.package_json.is_empty());
        assert!(f.asked.lock().unwrap()[1..].iter().all(|p| p.starts_with("repos/moonbeam/booking/")));
    }

    #[tokio::test]
    async fn not_found_signed_out_and_the_rate_limit_stop_the_lookup() {
        assert_eq!(collect("a/b", "web", &fake(vec![])).await, Err(Fail::NotFound));
        let mut signed_out = fake(vec![]);
        signed_out.otherwise = Some((vec![], Err(Fail::SignedOut)));
        assert_eq!(collect("a/b", "gh", &signed_out).await, Err(Fail::SignedOut));
        // The limit runs out half way: no half-filled answer.
        let mut limited = fake(vec![("repos/a/b", Ok(Some(meta().replace("moonbeam/web", "a/b"))))]);
        limited.otherwise = Some((vec!["repos/a/b".into()], Err(Fail::Limited(Some(3)))));
        assert_eq!(collect("a/b", "web", &limited).await, Err(Fail::Limited(Some(3))));
    }

    #[test]
    fn long_answers_are_cut_on_a_character_boundary() {
        assert_eq!(cap("ééé".into(), 2), "éé");
        assert_eq!(cap("ab".into(), 5), "ab");
        let many = json!((0..40).map(|i| json!({ "login": format!("u{i}"), "type": "User", "contributions": 1 })).collect::<Vec<_>>());
        assert_eq!(contributors_from(&many.to_string()).len(), CONTRIBUTORS);
        assert!(contributors_from("not json").is_empty());
    }
}
