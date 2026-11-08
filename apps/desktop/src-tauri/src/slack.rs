//! Slack: a recap posted to the channel an incoming webhook was made for.
//!
//! The webhook URL is the whole credential: whoever has it can post to that channel. It is
//! kept in the macOS Keychain (service `dev.aftercall.app`, account `slack-webhook`), checked
//! to be Slack's own (`https://hooks.slack.com/services/…`) when it is saved and again before
//! every post, and never handed back to the app's window: the window can only ask whether
//! one is set, save one, remove it, or post a recap's text through it. Errors never carry it.
//!
//! Nothing posts by itself. `slack_post_recap` runs only from a recap card's Post to Slack
//! button; autopilot, the paired phone and coding agents have no path to it.

use std::time::Duration;

use serde_json::json;

const KEYCHAIN_SERVICE: &str = "dev.aftercall.app";
const KEYCHAIN_ACCOUNT: &str = "slack-webhook";

/// Every Slack incoming webhook starts with this (`SLACK_WEBHOOK_PREFIX` in core).
pub const WEBHOOK_PREFIX: &str = "https://hooks.slack.com/services/";
/// Slack cuts a message's text after 40,000 characters; a recap that long is refused, not cut.
pub const TEXT_MAX: usize = 40_000;
/// A webhook answers in well under a second; past this, the post is given up.
pub const POST_TIMEOUT: Duration = Duration::from_secs(15);

const NOT_A_WEBHOOK: &str = "That isn't a Slack incoming webhook. Copy it again from Slack: it starts with https://hooks.slack.com/services/";

/// The webhook as saved: Slack's own address and path, `https://hooks.slack.com/services/T…/B…/…`,
/// three parts of letters and digits, with nothing before or after it. Spaces around a paste are trimmed.
pub fn check_webhook_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    let rest = url.strip_prefix(WEBHOOK_PREFIX).ok_or(NOT_A_WEBHOOK)?;
    let parts: Vec<&str> = rest.split('/').collect();
    let plain = |p: &&str| !p.is_empty() && p.len() <= 64 && p.bytes().all(|b| b.is_ascii_alphanumeric());
    if parts.len() != 3 || !parts.iter().all(plain) {
        return Err(NOT_A_WEBHOOK.into());
    }
    // The prefix already fixes the host; parsing it as a URL says the same, or it isn't sent.
    let parsed = reqwest::Url::parse(url).map_err(|_| NOT_A_WEBHOOK)?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("hooks.slack.com") || parsed.port().is_some() || !parsed.username().is_empty() {
        return Err(NOT_A_WEBHOOK.into());
    }
    Ok(url.to_string())
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

/// Saves the webhook in the Keychain, replacing one saved before. Only Slack's own is accepted.
pub fn set_webhook(url: &str) -> Result<(), String> {
    let url = check_webhook_url(url)?;
    entry()?
        .set_password(&url)
        .map_err(|e| format!("macOS Keychain didn't save the webhook ({e}). If macOS asked, choose Allow or Always Allow."))
}

/// Whether a webhook is saved. The window learns this and nothing else about it.
pub fn has_webhook() -> bool {
    entry().and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
}

/// Removes the webhook (Disconnect). One that isn't there counts as removed.
pub fn clear_webhook() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Posts a recap's text through the saved webhook, checked again to be Slack's own first.
pub async fn post_recap(text: &str) -> Result<(), String> {
    let saved = match entry()?.get_password() {
        Ok(url) => url,
        Err(keyring::Error::NoEntry) => return Err("Slack isn't connected. Add a webhook in Settings first.".into()),
        Err(e) => return Err(format!("macOS Keychain didn't give Aftercall the webhook ({e}).")),
    };
    let url = check_webhook_url(&saved)?;
    post_text(&url, text, POST_TIMEOUT).await
}

/// Posts `text` as a Slack message to `url`, which the caller has checked. No redirects are
/// followed, link previews are off, and no error names the URL.
pub async fn post_text(url: &str, text: &str, timeout: Duration) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("There's nothing in this recap to post.".into());
    }
    if text.chars().count() > TEXT_MAX {
        return Err("This recap is too long for one Slack message. Draft it in Mail instead.".into());
    }
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.without_url().to_string())?;
    let body = json!({ "text": text, "unfurl_links": false, "unfurl_media": false });
    let res = client
        .post(url)
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!("Slack didn't answer within {} seconds, so Aftercall can't tell whether it posted. Check the channel before you post again.", timeout.as_secs().max(1))
            } else if e.is_connect() {
                "Couldn't reach Slack. Check your connection, then try again.".to_string()
            } else {
                format!("Couldn't post to Slack: {}", e.without_url())
            }
        })?;
    let status = res.status();
    if status.is_success() {
        return Ok(());
    }
    // Slack answers a refusal with a short code ("no_service"); anything else isn't shown.
    let said = res.text().await.unwrap_or_default();
    let code = said.trim();
    let code = if !code.is_empty() && code.len() <= 40 && code.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') { format!(" ({code})") } else { String::new() };
    Err(match status.as_u16() {
        400 => format!("Slack refused the message{code}. Draft it in Mail instead."),
        403 => format!("Slack refused the webhook{code}. A workspace admin may have limited it."),
        404 => format!("Slack doesn't know this webhook any more{code}. Make a new one in Slack and connect it again in Settings."),
        410 => format!("The webhook's channel is archived{code}. Make a webhook for another channel and connect it in Settings."),
        429 => "Slack is limiting posts right now. Try again in a minute.".to_string(),
        300..=399 => "Slack answered with a redirect, which Aftercall doesn't follow. Check the channel before you post again.".to_string(),
        s if s >= 500 => format!("Slack had a problem (HTTP {s}). Try again later."),
        s => format!("Slack answered HTTP {s}{code}."),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    const HOOK: &str = "https://hooks.slack.com/services/T0001/B0002/abcDEF123";

    #[test]
    fn only_slack_incoming_webhooks_are_accepted() {
        assert_eq!(check_webhook_url(HOOK).as_deref(), Ok(HOOK));
        assert_eq!(check_webhook_url(&format!("  {HOOK}\n")).as_deref(), Ok(HOOK), "spaces around a paste are trimmed");
        for bad in [
            "",
            "http://hooks.slack.com/services/T0001/B0002/abcDEF123",
            "https://hooks.slack.com.evil.com/services/T0001/B0002/abcDEF123",
            "https://evil.com/hooks.slack.com/services/T0001/B0002/abcDEF123",
            "https://hooks.slack.com@evil.com/services/T0001/B0002/abcDEF123",
            "https://user@hooks.slack.com/services/T0001/B0002/abcDEF123",
            "https://hooks.slack.com:8443/services/T0001/B0002/abcDEF123",
            "https://hooks.slack.com./services/T0001/B0002/abcDEF123",
            "https://slack.com/services/T0001/B0002/abcDEF123",
            "https://hooks.slack.com/workflows/T0001/A0002/123/abc",
            "https://hooks.slack.com/services/T0001/B0002",
            "https://hooks.slack.com/services/T0001/B0002/abc/extra",
            "https://hooks.slack.com/services/T0001/B0002/abc/",
            "https://hooks.slack.com/services/T0001/B0002/abc?x=1",
            "https://hooks.slack.com/services/T0001/B0002/abc#x",
            "https://hooks.slack.com/services/T0001/B0002/../../x",
            "https://hooks.slack.com/services/T0001/B0002/ab%2Fc",
            "https://hooks.slack.com/services/T0001/B0002/ab c",
            "https://hooks.slack.com/services/T0001//abc",
            "https://hooks.slack.com\\@evil.com/services/T0001/B0002/abc",
            "HTTPS://HOOKS.SLACK.COM/services/T0001/B0002/abc",
            "https://hooks.slack.com/services/T0001/B0002/ａｂｃ",
        ] {
            assert_eq!(check_webhook_url(bad), Err(NOT_A_WEBHOOK.to_string()), "{bad}");
        }
        let long = format!("{WEBHOOK_PREFIX}T0001/B0002/{}", "a".repeat(65));
        assert!(check_webhook_url(&long).is_err());
    }

    /// Serves one request with `status` and `reply`, sending back what it received.
    fn fake_slack(status: &'static str, reply: &'static str) -> (String, mpsc::Receiver<(String, Vec<u8>)>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/services/T0001/B0002/abcDEF123", listener.local_addr().unwrap());
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line.to_lowercase().starts_with("content-length:") {
                    length = line[15..].trim().parse().unwrap();
                }
                head.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let mut out = stream;
            write!(out, "HTTP/1.1 {status}\r\ncontent-type: text/html\r\nlocation: http://127.0.0.1:9/elsewhere\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}", reply.len()).unwrap();
            tx.send((head, body)).unwrap();
        });
        (url, rx)
    }

    const SECS: Duration = Duration::from_secs(5);

    #[tokio::test]
    async fn a_recap_posts_as_json_text_to_the_webhook() {
        let (url, rx) = fake_slack("200 OK", "ok");
        let text = "*Recap: API fix*\n\nHi Ada, thanks for the call.\n--\nWhat was and wasn't checked: https://aftercall.app/verify#x";
        post_text(&url, text, SECS).await.unwrap();
        let (head, body) = rx.recv().unwrap();
        let head = head.to_lowercase();
        assert!(head.starts_with("post /services/t0001/b0002/abcdef123 http/1.1"), "{head}");
        assert!(head.contains("content-type: application/json"));
        let sent: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(sent, json!({ "text": text, "unfurl_links": false, "unfurl_media": false }), "only the text, as given, with link previews off");
    }

    #[tokio::test]
    async fn slack_refusals_read_in_plain_words_and_never_name_the_webhook() {
        for (status, reply, want) in [
            ("404 Not Found", "no_service", "Slack doesn't know this webhook any more (no_service). Make a new one"),
            ("410 Gone", "channel_is_archived", "The webhook's channel is archived (channel_is_archived)"),
            ("403 Forbidden", "action_prohibited", "Slack refused the webhook (action_prohibited)"),
            ("400 Bad Request", "invalid_payload", "Slack refused the message (invalid_payload)"),
            ("429 Too Many Requests", "rate_limited", "Slack is limiting posts right now"),
            ("500 Internal Server Error", "<html>oops</html>", "Slack had a problem (HTTP 500)"),
            ("302 Found", "", "Slack answered with a redirect, which Aftercall doesn't follow"),
        ] {
            let (url, rx) = fake_slack(status, reply);
            let err = post_text(&url, "Recap", SECS).await.unwrap_err();
            assert!(err.starts_with(want), "{status}: {err}");
            assert!(!err.contains("abcDEF123") && !err.contains("127.0.0.1"), "{err}");
            assert!(!err.contains("<html>"), "a page Slack sends back isn't shown");
            rx.recv().unwrap();
        }
    }

    #[tokio::test]
    async fn a_slack_that_doesnt_answer_times_out_without_naming_the_webhook() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/services/T0001/B0002/abcDEF123", listener.local_addr().unwrap());
        // Accepts and reads, never answers.
        let hold = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut sink = [0u8; 1024];
            let _ = stream.read(&mut sink);
            std::thread::sleep(Duration::from_millis(800));
        });
        let err = post_text(&url, "Recap", Duration::from_millis(300)).await.unwrap_err();
        assert!(err.contains("can't tell whether it posted"), "{err}");
        assert!(!err.contains("abcDEF123"), "{err}");
        hold.join().unwrap();

        // Nobody listening: a plain sentence, and still no URL.
        let gone = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/services/T0001/B0002/abcDEF123", gone.local_addr().unwrap());
        drop(gone);
        let err = post_text(&url, "Recap", SECS).await.unwrap_err();
        assert_eq!(err, "Couldn't reach Slack. Check your connection, then try again.");
    }

    #[tokio::test]
    async fn nothing_is_sent_for_an_empty_or_too_long_recap() {
        let (url, rx) = fake_slack("200 OK", "ok");
        assert!(post_text(&url, "  \n ", SECS).await.is_err());
        assert!(post_text(&url, &"a".repeat(TEXT_MAX + 1), SECS).await.unwrap_err().contains("Draft it in Mail"));
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "no request reached the server");
    }
}
