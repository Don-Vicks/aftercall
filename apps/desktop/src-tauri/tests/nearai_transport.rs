//! The NEAR AI transport against a local fake server: multipart upload, exact
//! response bytes, the bearer key, and the read-only path guard.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;

/// Serves one request with `reply`, sending back what it received.
fn fake_server(reply: &'static str) -> (String, mpsc::Receiver<(String, Vec<u8>)>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
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
        write!(out, "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}", reply.len()).unwrap();
        tx.send((head, body)).unwrap();
    });
    (url, rx)
}

// Each test sets its own server URL, so they run one at a time.
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn point_at(url: &str) {
    // SAFETY: the LOCK keeps tests from touching the environment concurrently.
    unsafe {
        std::env::set_var("NEARAI_BASE_URL", url);
        std::env::set_var("NEARAI_API_KEY", "test-key-0123456789");
    }
}

#[tokio::test]
async fn chat_sends_and_returns_exact_bytes() {
    let _g = LOCK.lock().unwrap();
    let reply = r#"{"id":"chatcmpl-1","choices":[{"message":{"content":"{\"title\":\"Sync\"}"}}]}"#;
    let (url, rx) = fake_server(reply);
    point_at(&url);
    let body = r#"{"model":"Qwen/Qwen3.8-27B","messages":[{"role":"user","content":"naïve café"}]}"#.to_string();

    let e2ee = aftercall_desktop_lib::test_api::E2ee { client_pub_key: "a1".repeat(32), model_pub_key: "b2".repeat(32) };

    let got = aftercall_desktop_lib::test_api::chat(body.clone(), e2ee).await.unwrap();
    assert_eq!(got, reply, "response bytes are returned untouched");
    let (head, sent) = rx.recv().unwrap();
    assert_eq!(sent, body.as_bytes(), "request bytes are sent untouched");
    let head = head.to_lowercase();
    assert!(head.starts_with("post /v1/chat/completions"));
    assert!(head.contains("authorization: bearer test-key-0123456789"));
    assert!(head.contains("accept-encoding: identity"));
    assert!(head.contains("x-encryption-version: 2"), "every request is end-to-end encrypted");
}

#[tokio::test]
async fn encrypted_chat_sends_the_e2ee_headers() {
    let _g = LOCK.lock().unwrap();
    let (url, rx) = fake_server(r#"{"id":"chatcmpl-2","choices":[]}"#);
    point_at(&url);
    let e2ee = aftercall_desktop_lib::test_api::E2ee { client_pub_key: "a1".repeat(32), model_pub_key: "b2".repeat(32) };

    aftercall_desktop_lib::test_api::chat("{}".into(), e2ee).await.unwrap();
    let (head, _) = rx.recv().unwrap();
    let head = head.to_lowercase();
    assert!(head.contains("x-signing-algo: ed25519"));
    assert!(head.contains(&format!("x-client-pub-key: {}", "a1".repeat(32))));
    assert!(head.contains(&format!("x-model-pub-key: {}", "b2".repeat(32))));
    assert!(head.contains("x-encryption-version: 2"));
}

#[tokio::test]
async fn malformed_e2ee_keys_send_nothing() {
    let _g = LOCK.lock().unwrap();
    let (url, rx) = fake_server("{}");
    point_at(&url);
    let e2ee = aftercall_desktop_lib::test_api::E2ee { client_pub_key: "a1".repeat(32), model_pub_key: "ab".into() };

    assert!(aftercall_desktop_lib::test_api::chat("{}".into(), e2ee).await.is_err());
    assert!(rx.recv_timeout(std::time::Duration::from_millis(300)).is_err(), "no request reached the server");
}

#[tokio::test]
async fn transcribe_uploads_the_file_as_multipart() {
    let _g = LOCK.lock().unwrap();
    let (url, rx) = fake_server(r#"{"text":"hello","segments":[]}"#);
    point_at(&url);
    let file = std::env::temp_dir().join(format!("mic-000-{}.wav", std::process::id()));
    std::fs::write(&file, b"RIFF-fake-audio").unwrap();

    let got = aftercall_desktop_lib::test_api::transcribe(file.clone(), "openai/whisper-large-v3".into(), "Ada, Designer".into()).await.unwrap();
    assert_eq!(got, r#"{"text":"hello","segments":[]}"#);
    let (head, sent) = rx.recv().unwrap();
    let sent = String::from_utf8_lossy(&sent);
    assert!(head.to_lowercase().starts_with("post /v1/audio/transcriptions"));
    assert!(head.to_lowercase().contains("multipart/form-data"));
    for part in ["name=\"model\"", "openai/whisper-large-v3", "name=\"response_format\"", "verbose_json", "name=\"prompt\"", "Ada, Designer", "RIFF-fake-audio"] {
        assert!(sent.contains(part), "upload is missing {part}");
    }
    std::fs::remove_file(file).unwrap();
}

/// Hits the real NEAR AI; run with `cargo test -- --ignored`.
#[tokio::test]
#[ignore]
async fn a_made_up_key_is_reported_invalid_by_near_ai() {
    let _g = LOCK.lock().unwrap();
    // SAFETY: under LOCK.
    unsafe { std::env::remove_var("NEARAI_BASE_URL") };
    assert_eq!(aftercall_desktop_lib::test_api::check_key("sk-not-a-real-key-000000000000").await, "invalid");
}

/// Serves one request with `parts` written one at a time, `pause` apart, then closes
/// (no content-length, as a stream ends). Sends back what it received.
fn streaming_server(parts: Vec<&'static str>, pause: std::time::Duration) -> (String, mpsc::Receiver<(String, Vec<u8>)>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
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
        tx.send((head, body)).unwrap();
        let mut out = stream;
        write!(out, "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n").unwrap();
        for part in parts {
            if out.write_all(part.as_bytes()).is_err() {
                return;
            }
            out.flush().unwrap();
            std::thread::sleep(pause);
        }
    });
    (url, rx)
}

const STREAM: [&str; 4] = [
    "data: {\"id\":\"chatcmpl-5\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"}}]}\n\n",
    "data: {\"id\":\"chatcmpl-5\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"a1b2\"}}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":1}}\n\nda",
    "ta: {\"id\":\"chatcmpl-5\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"c3d4\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":2}}\r\n\r\n",
    "data: [DONE]\n\n",
];

#[tokio::test]
async fn the_notes_stream_comes_back_byte_for_byte_with_progress() {
    let _g = LOCK.lock().unwrap();
    let (url, rx) = streaming_server(STREAM.to_vec(), std::time::Duration::from_millis(300));
    point_at(&url);
    let e2ee = aftercall_desktop_lib::test_api::E2ee { client_pub_key: "a1".repeat(32), model_pub_key: "b2".repeat(32) };
    let body = r#"{"model":"Qwen/Qwen3.8-27B","stream":true,"messages":[]}"#.to_string();
    let mut seen = Vec::new();
    let got = aftercall_desktop_lib::test_api::chat_stream_with(body.clone(), e2ee, std::time::Duration::from_secs(5), std::time::Duration::from_secs(5), |p| seen.push(p))
        .await
        .unwrap();
    assert_eq!(got, STREAM.concat(), "every byte of the stream, line endings and all");
    let (head, sent) = rx.recv().unwrap();
    assert_eq!(sent, body.as_bytes());
    let head = head.to_lowercase();
    assert!(head.contains("accept-encoding: identity"));
    assert!(head.contains("x-encryption-version: 2"), "always end-to-end encrypted");
    assert!(head.contains(&format!("x-model-pub-key: {}", "b2".repeat(32))));
    assert!(seen.len() >= 2, "progress while it streams, not only at the end");
    let last = seen.last().unwrap();
    assert_eq!((last.events, last.output_tokens, last.bytes), (3, Some(2), STREAM.concat().len() as u64));
}

#[tokio::test]
async fn a_stream_that_goes_quiet_stops_after_the_idle_limit_not_a_total_one() {
    let _g = LOCK.lock().unwrap();
    // Slow but steady: each piece 400 ms apart, 1.2 s in all, under a 700 ms idle limit.
    let (url, _rx) = streaming_server(STREAM.to_vec(), std::time::Duration::from_millis(400));
    point_at(&url);
    let e2ee = || aftercall_desktop_lib::test_api::E2ee { client_pub_key: "a1".repeat(32), model_pub_key: "b2".repeat(32) };
    let ms = std::time::Duration::from_millis;
    assert!(aftercall_desktop_lib::test_api::chat_stream_with("{}".into(), e2ee(), ms(2000), ms(700), |_| {}).await.is_ok());

    // One piece, then silence.
    let (url, _rx) = streaming_server(vec![STREAM[0]], std::time::Duration::from_secs(3));
    point_at(&url);
    let err = aftercall_desktop_lib::test_api::chat_stream_with("{}".into(), e2ee(), ms(2000), ms(500), |_| {}).await.unwrap_err();
    assert!(err.contains("stopped sending the notes"), "{err}");
}

#[tokio::test]
async fn malformed_e2ee_keys_send_no_stream_request() {
    let _g = LOCK.lock().unwrap();
    let (url, rx) = fake_server("{}");
    point_at(&url);
    let e2ee = aftercall_desktop_lib::test_api::E2ee { client_pub_key: "a1".repeat(32), model_pub_key: "zz".repeat(32) };
    let ms = std::time::Duration::from_millis;
    assert!(aftercall_desktop_lib::test_api::chat_stream_with("{}".into(), e2ee, ms(500), ms(500), |_| {}).await.is_err());
    assert!(rx.recv_timeout(ms(300)).is_err(), "no request reached the server");
}
