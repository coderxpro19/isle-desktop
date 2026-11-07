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
        model: "gemini-3.8-flash",
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

/// Model ids are single tokens like "gemini-2.5-flash", "gpt-4o-mini", "llama3.2:3b".
pub fn looks_like_model(m: &str) -> bool {
    !m.is_empty()
        && m.chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:/-".contains(c))
        && m.chars().any(|c| c.is_ascii_digit() || c == '-')
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

/// Models picked automatically per provider (providers retire models over
/// time, so the newest suitable one is looked up from the key's model list).
fn resolved() -> &'static Mutex<HashMap<String, String>> {
    static R: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Version numbers in a model id, for "newest first" ordering ("gemini-3.8-flash" → [3, 8]).
fn version(id: &str) -> Vec<u32> {
    id.split(|c: char| !c.is_ascii_digit())
        .filter_map(|n| n.parse().ok())
        .take(3)
        .collect()
}

/// Choose the best everyday model from a provider's model list.
pub fn pick_model(provider: &str, ids: &[String]) -> Option<String> {
    let has = |id: &str, words: &[&str]| words.iter().any(|w| id.contains(w));
    let newest = |mut v: Vec<&String>| {
        v.sort_by(|a, b| version(b).cmp(&version(a)).then(a.len().cmp(&b.len())));
        v.first().map(|s| s.to_string())
    };
    let ids: Vec<&String> = ids.iter().collect();
    match provider {
        "gemini" => {
            let flash: Vec<&String> = ids
                .iter()
                .copied()
                .filter(|i| i.contains("gemini") && i.contains("flash"))
                .collect();
            let avoid = [
                "lite",
                "image",
                "tts",
                "audio",
                "live",
                "embedding",
                "thinking",
                "8b",
            ];
            let stable: Vec<&String> = flash
                .iter()
                .copied()
                .filter(|i| !has(i, &avoid) && !has(i, &["preview", "exp"]))
                .collect();
            let any: Vec<&String> = flash.iter().copied().filter(|i| !has(i, &avoid)).collect();
            newest(stable).or_else(|| newest(any)).or_else(|| {
                newest(
                    ids.iter()
                        .copied()
                        .filter(|i| i.contains("gemini"))
                        .collect(),
                )
            })
        }
        "openai" => {
            let chat = |i: &&String| {
                i.starts_with("gpt-")
                    && !has(
                        i,
                        &[
                            "audio",
                            "realtime",
                            "search",
                            "transcribe",
                            "tts",
                            "image",
                            "instruct",
                        ],
                    )
            };
            newest(
                ids.iter()
                    .copied()
                    .filter(chat)
                    .filter(|i| i.ends_with("-mini"))
                    .collect(),
            )
            .or_else(|| newest(ids.iter().copied().filter(chat).collect()))
        }
        // The list is newest-first.
        "anthropic" => ids
            .iter()
            .find(|i| i.contains("haiku"))
            .or(ids.first())
            .map(|s| s.to_string()),
        "groq" => ids
            .iter()
            .find(|i| i.contains("versatile"))
            .or_else(|| {
                ids.iter()
                    .find(|i| i.contains("llama") && !has(i, &["guard", "whisper"]))
            })
            .or(ids.iter().find(|i| !has(i, &["whisper", "guard", "tts"])))
            .map(|s| s.to_string()),
        _ => None,
    }
}

/// Model ids available to this key.
async fn list_models(p: &Provider, base: &str, key: Option<&str>) -> Result<Vec<String>, String> {
    let c = client();
    let req = match p.kind {
        Kind::Gemini => c
            .get(format!("{base}/models?pageSize=200"))
            .header("x-goog-api-key", key.unwrap_or_default()),
        Kind::OpenAi => {
            let r = c.get(format!("{base}/models"));
            match key {
                Some(k) => r.bearer_auth(k),
                None => r,
            }
        }
        Kind::Anthropic => c
            .get(format!("{base}/models?limit=100"))
            .header("x-api-key", key.unwrap_or_default())
            .header("anthropic-version", "2023-06-01"),
    };
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("{}", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let ids = match p.kind {
        Kind::Gemini => v["models"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter(|m| {
                        m["supportedGenerationMethods"]
                            .as_array()
                            .is_none_or(|g| g.iter().any(|x| x == "generateContent"))
                    })
                    .filter_map(|m| m["name"].as_str())
                    .map(|n| n.trim_start_matches("models/").to_string())
                    .collect()
            })
            .unwrap_or_default(),
        _ => v["data"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|m| m["id"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
    };
    Ok(ids)
}

/// A model id the provider suggests in an error ("…use models/gemini-3.8-flash…").
pub fn suggested_model(err: &str) -> Option<String> {
    let i = err.rfind("models/")?;
    let id: String = err[i + 7..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || "._-".contains(*c))
        .collect();
    let id = id.trim_end_matches('.').to_string();
    looks_like_model(&id).then_some(id)
}

enum Failure {
    /// The model doesn't exist (any more): try another.
    Model(String),
    Other(String),
}

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
    let base = base_url
        .filter(|b| p.id == "custom" && !b.trim().is_empty())
        .unwrap_or_else(|| p.base.to_string());
    let base = base.trim_end_matches('/').to_string();
    // Ignore anything that isn't a model id (e.g. a name typed in by mistake).
    let chosen = model
        .map(|m| m.trim().to_string())
        .filter(|m| looks_like_model(m));
    let auto = chosen.is_none();
    let mut model = match chosen {
        Some(m) => m,
        None => {
            let cached = resolved().lock().get(p.id).cloned();
            match cached {
                Some(m) => m,
                None => {
                    let picked = list_models(p, &base, key.as_deref())
                        .await
                        .ok()
                        .and_then(|ids| pick_model(p.id, &ids));
                    let m = picked.unwrap_or_else(|| p.model.to_string());
                    log::info!("ai: {} → {m}", p.id);
                    resolved().lock().insert(p.id.to_string(), m.clone());
                    m
                }
            }
        }
    };
    let mut retried = false;
    loop {
        match stream(&app, &id, p, &base, key.as_deref(), &model, &messages).await {
            Ok(full) => return Ok(full),
            Err(Failure::Model(msg)) if !retried => {
                retried = true;
                // Retired or unknown model: use the provider's suggestion, else the newest from the list.
                let next = match suggested_model(&msg).filter(|m| *m != model) {
                    Some(m) => Some(m),
                    None => list_models(p, &base, key.as_deref())
                        .await
                        .ok()
                        .and_then(|ids| {
                            pick_model(
                                p.id,
                                &ids.into_iter().filter(|i| *i != model).collect::<Vec<_>>(),
                            )
                        }),
                };
                match next.filter(|m| *m != model) {
                    Some(m) => {
                        log::info!("ai: {model} unavailable, switching to {m}");
                        if auto {
                            resolved().lock().insert(p.id.to_string(), m.clone());
                        }
                        model = m;
                    }
                    None => return Err(msg),
                }
            }
            Err(Failure::Model(msg) | Failure::Other(msg)) => return Err(msg),
        }
    }
}

async fn stream(
    app: &AppHandle,
    id: &str,
    p: &Provider,
    base: &str,
    key: Option<&str>,
    model: &str,
    messages: &[Msg],
) -> Result<String, Failure> {
    let body = request(p.kind, model, SYSTEM, messages);
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
        Failure::Other(if e.is_connect() {
            "Couldn't reach the AI service. Check your connection.".to_string()
        } else {
            e.to_string()
        })
    })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let msg = error_text(&text);
        return Err(match status.as_u16() {
            401 | 403 => Failure::Other(format!("Your API key was rejected ({msg}).")),
            429 => Failure::Other("Rate limit reached — wait a moment and try again.".into()),
            404 => Failure::Model(format!("{status}: {msg}")),
            400 if msg.to_lowercase().contains("model") => {
                Failure::Model(format!("{status}: {msg}"))
            }
            _ => Failure::Other(format!("{status}: {msg}")),
        });
    }
    let mut sse = Sse::default();
    let mut full = String::new();
    while let Some(bytes) = resp
        .chunk()
        .await
        .map_err(|e| Failure::Other(e.to_string()))?
    {
        if cancelled().lock().remove(id) {
            break;
        }
        for data in sse.feed(&bytes) {
            if let Some(d) = delta(p.kind, &data) {
                full.push_str(&d);
                let _ = app.emit("ai://chunk", Chunk { id, delta: &d });
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
    fn picks_newest_everyday_models() {
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let g = v(&[
            "gemini-2.5-flash",
            "gemini-3.8-flash",
            "gemini-3.8-flash-lite",
            "gemini-3.9-flash-preview-05",
            "gemini-3.8-pro",
            "text-embedding-004",
        ]);
        assert_eq!(
            pick_model("gemini", &g).as_deref(),
            Some("gemini-3.8-flash")
        );
        assert_eq!(
            pick_model("gemini", &v(&["gemini-4.0-flash-preview"])).as_deref(),
            Some("gemini-4.0-flash-preview")
        );
        let o = v(&[
            "gpt-4o-mini",
            "gpt-5.1-mini",
            "gpt-5.1",
            "gpt-4o-mini-tts",
            "whisper-1",
        ]);
        assert_eq!(pick_model("openai", &o).as_deref(), Some("gpt-5.1-mini"));
        let a = v(&["claude-opus-5-5", "claude-haiku-5-5", "claude-haiku-4-5"]);
        assert_eq!(
            pick_model("anthropic", &a).as_deref(),
            Some("claude-haiku-5-5")
        );
        assert_eq!(
            pick_model("groq", &v(&["whisper-large", "llama-3.3-70b-versatile"])).as_deref(),
            Some("llama-3.3-70b-versatile")
        );
    }

    #[test]
    fn reads_suggested_model() {
        let e = "404: This model models/gemini-2.5-flash is no longer available. Please update your code to use models/gemini-3.8-flash for the latest.";
        // The first models/… is the retired one; the suggestion is the last mention.
        assert_eq!(suggested_model(e).as_deref(), Some("gemini-3.8-flash"));
        assert_eq!(suggested_model("400: bad request"), None);
    }

    #[test]
    fn model_ids() {
        assert!(!looks_like_model("Prince"));
        assert!(!looks_like_model("my model"));
        assert!(looks_like_model("gemini-2.5-flash"));
        assert!(looks_like_model("llama3.2:3b"));
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
