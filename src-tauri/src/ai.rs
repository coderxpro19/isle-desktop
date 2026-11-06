//! The notch's AI assistant. Users bring their own key (Gemini, OpenAI, Claude,
//! Groq or any OpenAI-compatible server); keys live in the Windows Credential
//! Locker, never in the settings file. Replies stream back as `ai://chunk` events.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct Msg {
    /// "user" | "assistant"
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Gemini,
    OpenAi,
    Anthropic,
}

pub struct Provider {
    pub id: &'static str,
    pub kind: Kind,
    pub base: &'static str,
    pub model: &'static str,
    pub key_page: &'static str,
}

pub const PROVIDERS: [Provider; 5] = [
    Provider {
        id: "gemini",
        kind: Kind::Gemini,
        base: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.5-flash",
        key_page: "https://aistudio.google.com/apikey",
    },
    Provider {
        id: "openai",
        kind: Kind::OpenAi,
        base: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        key_page: "https://platform.openai.com/api-keys",
    },
    Provider {
        id: "anthropic",
        kind: Kind::Anthropic,
        base: "https://api.anthropic.com/v1",
        model: "claude-haiku-5-5",
        key_page: "https://console.anthropic.com/settings/keys",
    },
    Provider {
        id: "groq",
        kind: Kind::OpenAi,
        base: "https://api.groq.com/openai/v1",
        model: "llama-3.3-70b-versatile",
        key_page: "https://console.groq.com/keys",
    },
    Provider {
        id: "custom",
        kind: Kind::OpenAi,
        base: "http://localhost:11434/v1",
        model: "llama3.2",
        key_page: "https://ollama.com/download",
    },
];

pub fn find_provider(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.id == id)
}

/* ───────────── request / response shapes ───────────── */

pub fn request(kind: Kind, model: &str, system: &str, msgs: &[Msg]) -> serde_json::Value {
    use serde_json::json;
    match kind {
        Kind::Gemini => json!({
            "systemInstruction": { "parts": [{ "text": system }] },
            "contents": msgs.iter().map(|m| json!({
                "role": if m.role == "assistant" { "model" } else { "user" },
                "parts": [{ "text": m.content }],
            })).collect::<Vec<_>>(),
        }),
        Kind::OpenAi => {
            let mut all = vec![json!({ "role": "system", "content": system })];
            all.extend(
                msgs.iter()
                    .map(|m| json!({ "role": m.role, "content": m.content })),
            );
            json!({ "model": model, "stream": true, "messages": all })
        }
        Kind::Anthropic => json!({
            "model": model,
            "max_tokens": 2048,
            "stream": true,
            "system": system,
            "messages": msgs.iter().map(|m| json!({ "role": m.role, "content": m.content })).collect::<Vec<_>>(),
        }),
    }
}

/// Text carried by one SSE `data:` payload, if any.
pub fn delta(kind: Kind, data: &str) -> Option<String> {
    if data == "[DONE]" {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(data).ok()?;
    let s = match kind {
        Kind::Gemini => v["candidates"][0]["content"]["parts"]
            .as_array()?
            .iter()
            .filter_map(|p| p["text"].as_str())
            .collect::<String>(),
        Kind::OpenAi => v["choices"][0]["delta"]["content"].as_str()?.to_string(),
        Kind::Anthropic => {
            if v["type"] != "content_block_delta" {
                return None;
            }
            v["delta"]["text"].as_str()?.to_string()
        }
    };
    (!s.is_empty()).then_some(s)
}

/// An error message from a provider's JSON error body.
pub fn error_text(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or_else(|| v[0]["error"]["message"].as_str())
                .or_else(|| v["message"].as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(200).collect())
}

/// Incremental Server-Sent-Events splitter: feed bytes, get complete `data:` payloads.
#[derive(Default)]
pub struct Sse {
    buf: String,
}

impl Sse {
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buf.push_str(&String::from_utf8_lossy(bytes));
        let mut out = Vec::new();
        while let Some(i) = self.buf.find('\n') {
            let line: String = self.buf.drain(..=i).collect();
            let line = line.trim_end_matches(['\r', '\n']);
            if let Some(d) = line.strip_prefix("data:") {
                out.push(d.trim_start().to_string());
            }
        }
        out
    }
}

/* ───────────── keys (Credential Locker) ───────────── */

#[cfg_attr(not(windows), allow(dead_code))]
const VAULT: &str = "Isle AI";

#[cfg(windows)]
mod keys {
    use super::VAULT;
    use windows::core::HSTRING;
    use windows::Security::Credentials::{PasswordCredential, PasswordVault};

    pub fn get(provider: &str) -> Option<String> {
        let v = PasswordVault::new().ok()?;
        let c = v
            .Retrieve(&HSTRING::from(VAULT), &HSTRING::from(provider))
            .ok()?;
        c.RetrievePassword().ok()?;
        c.Password()
            .ok()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
    }

    pub fn set(provider: &str, key: Option<&str>) -> Result<(), String> {
        let v = PasswordVault::new().map_err(|e| e.to_string())?;
        if let Ok(old) = v.Retrieve(&HSTRING::from(VAULT), &HSTRING::from(provider)) {
            let _ = v.Remove(&old);
        }
        if let Some(k) = key.filter(|k| !k.trim().is_empty()) {
            let c = PasswordCredential::CreatePasswordCredential(
                &HSTRING::from(VAULT),
                &HSTRING::from(provider),
                &HSTRING::from(k.trim()),
            )
            .map_err(|e| e.to_string())?;
            v.Add(&c).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod keys {
    use parking_lot::Mutex;
    use std::collections::HashMap;
    static MEM: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
    pub fn get(provider: &str) -> Option<String> {
        MEM.lock().as_ref()?.get(provider).cloned()
    }
    pub fn set(provider: &str, key: Option<&str>) -> Result<(), String> {
        let mut m = MEM.lock();
        let map = m.get_or_insert_with(HashMap::new);
        match key.filter(|k| !k.trim().is_empty()) {
            Some(k) => map.insert(provider.into(), k.trim().into()),
            None => map.remove(provider),
        };
        Ok(())
    }
}

#[tauri::command]
pub fn ai_set_key(provider: String, key: Option<String>) -> Result<(), String> {
    find_provider(&provider).ok_or("unknown provider")?;
    keys::set(&provider, key.as_deref())
}

/// Which providers have a key saved (custom servers may not need one).
#[tauri::command]
pub fn ai_keys() -> HashMap<String, bool> {
    PROVIDERS
        .iter()
        .map(|p| (p.id.to_string(), keys::get(p.id).is_some()))
        .collect()
}

#[tauri::command]
pub fn ai_key_page(provider: String) -> Result<(), String> {
    let p = find_provider(&provider).ok_or("unknown provider")?;
    crate::dock::open_shell(p.key_page)
}

/* ───────────── asking ───────────── */

fn cancelled() -> &'static Mutex<HashSet<String>> {
    static C: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashSet::new()))
}

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .user_agent(concat!("Isle/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default()
    })
}

#[derive(Clone, Serialize)]
struct Chunk<'a> {
    id: &'a str,
    delta: &'a str,
}

const SYSTEM: &str = "You are Isle, a helpful assistant living in the user's Windows notch. \
Be concise and direct: short paragraphs, plain text or light Markdown, no preamble. \
When asked to rewrite, translate or fix text, reply with only the result.";

/// Ask the model; streams `ai://chunk` and resolves with the full reply.
#[tauri::command]
pub async fn ai_ask(
    app: AppHandle,
    id: String,
    provider: String,
    model: Option<String>,
    base_url: Option<String>,
    messages: Vec<Msg>,
) -> Result<String, String> {
    let p = find_provider(&provider).ok_or("Unknown AI provider")?;
    let key = keys::get(p.id);
    if key.is_none() && p.id != "custom" {
        return Err("Add your API key first.".into());
    }
    let model = model
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| p.model.to_string());
    let base = base_url
        .filter(|b| p.id == "custom" && !b.trim().is_empty())
        .unwrap_or_else(|| p.base.to_string());
    let base = base.trim_end_matches('/');
    let body = request(p.kind, &model, SYSTEM, &messages);
    let c = client();
    let req = match p.kind {
        Kind::Gemini => c
            .post(format!(
                "{base}/models/{model}:streamGenerateContent?alt=sse"
            ))
            .header("x-goog-api-key", key.unwrap_or_default()),
        Kind::OpenAi => {
            let r = c.post(format!("{base}/chat/completions"));
            match key {
                Some(k) => r.bearer_auth(k),
                None => r,
            }
        }
        Kind::Anthropic => c
            .post(format!("{base}/messages"))
            .header("x-api-key", key.unwrap_or_default())
            .header("anthropic-version", "2023-06-01"),
    };
    let mut resp = req.json(&body).send().await.map_err(|e| {
        if e.is_connect() {
            "Couldn't reach the AI service. Check your connection.".to_string()
        } else {
            e.to_string()
        }
    })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(match status.as_u16() {
            401 | 403 => format!("Your API key was rejected ({}).", error_text(&text)),
            429 => "Rate limit reached — wait a moment and try again.".into(),
            _ => format!("{status}: {}", error_text(&text)),
        });
    }
    let mut sse = Sse::default();
    let mut full = String::new();
    while let Some(bytes) = resp.chunk().await.map_err(|e| e.to_string())? {
        if cancelled().lock().remove(&id) {
            break;
        }
        for data in sse.feed(&bytes) {
            if let Some(d) = delta(p.kind, &data) {
                full.push_str(&d);
                let _ = app.emit("ai://chunk", Chunk { id: &id, delta: &d });
            }
        }
    }
    Ok(full)
}

#[tauri::command]
pub fn ai_cancel(id: String) {
    cancelled().lock().insert(id);
}

/// Put text on the clipboard and paste it into the app that was in front
/// when the assistant was opened with its hotkey.
#[tauri::command]
pub fn ai_paste(text: String) -> Result<(), String> {
    crate::clipboard::paste_text(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(role: &str, c: &str) -> Msg {
        Msg {
            role: role.into(),
            content: c.into(),
        }
    }

    #[test]
    fn sse_splits_across_chunks() {
        let mut s = Sse::default();
        assert!(s.feed(b"data: {\"a\"").is_empty());
        assert_eq!(
            s.feed(b":1}\r\n\r\nevent: x\ndata: [DONE]\n"),
            vec!["{\"a\":1}", "[DONE]"]
        );
    }

    #[test]
    fn deltas_per_provider() {
        assert_eq!(
            delta(
                Kind::Gemini,
                r#"{"candidates":[{"content":{"parts":[{"text":"Hi"},{"text":"!"}]}}]}"#
            )
            .as_deref(),
            Some("Hi!")
        );
        assert_eq!(
            delta(Kind::OpenAi, r#"{"choices":[{"delta":{"content":"Yo"}}]}"#).as_deref(),
            Some("Yo")
        );
        assert_eq!(delta(Kind::OpenAi, r#"{"choices":[{"delta":{}}]}"#), None);
        assert_eq!(delta(Kind::OpenAi, "[DONE]"), None);
        assert_eq!(
            delta(
                Kind::Anthropic,
                r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hey"}}"#
            )
            .as_deref(),
            Some("Hey")
        );
        assert_eq!(delta(Kind::Anthropic, r#"{"type":"message_start"}"#), None);
    }

    #[test]
    fn request_shapes() {
        let msgs = [m("user", "hi"), m("assistant", "hello"), m("user", "again")];
        let g = request(Kind::Gemini, "x", "sys", &msgs);
        assert_eq!(g["contents"][1]["role"], "model");
        assert_eq!(g["systemInstruction"]["parts"][0]["text"], "sys");
        let o = request(Kind::OpenAi, "gpt", "sys", &msgs);
        assert_eq!(o["messages"][0]["role"], "system");
        assert_eq!(o["messages"].as_array().unwrap().len(), 4);
        let a = request(Kind::Anthropic, "claude", "sys", &msgs);
        assert_eq!(a["system"], "sys");
        assert_eq!(a["messages"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn errors_are_readable() {
        assert_eq!(
            error_text(r#"{"error":{"message":"API key not valid"}}"#),
            "API key not valid"
        );
        assert_eq!(error_text(r#"[{"error":{"message":"quota"}}]"#), "quota");
        assert_eq!(error_text("plain"), "plain");
    }

    #[test]
    fn keys_round_trip_off_windows() {
        if cfg!(windows) {
            return;
        }
        ai_set_key("groq".into(), Some(" k1 ".into())).unwrap();
        assert!(ai_keys()["groq"]);
        ai_set_key("groq".into(), None).unwrap();
        assert!(!ai_keys()["groq"]);
    }
}
