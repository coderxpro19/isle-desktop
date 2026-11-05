//! Calendar feeds: download ICS files (Google/Outlook "secret address" links).
//! Done natively because those servers don't send CORS headers for the webview.
//! Parsing happens in the UI (`src/lib/ics.ts`).

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub url: String,
    pub ics: Option<String>,
    pub error: Option<String>,
}

/// `webcal://` → `https://`; only http(s) is allowed.
pub fn normalise(url: &str) -> Option<String> {
    let u = url.trim();
    let u = if let Some(rest) = u.strip_prefix("webcal://") {
        format!("https://{rest}")
    } else {
        u.to_string()
    };
    (u.starts_with("https://") || u.starts_with("http://")).then_some(u)
}

#[tauri::command]
pub async fn calendar_fetch(urls: Vec<String>) -> Vec<Feed> {
    let jobs = urls.into_iter().map(|url| {
        tauri::async_runtime::spawn_blocking(move || {
            let r = normalise(&url)
                .ok_or_else(|| "Use an https:// or webcal:// link".to_string())
                .and_then(|u| platform::get(&u));
            match r {
                Ok(ics) => Feed {
                    url,
                    ics: Some(ics),
                    error: None,
                },
                Err(e) => Feed {
                    url,
                    ics: None,
                    error: Some(e),
                },
            }
        })
    });
    let mut out = Vec::new();
    for j in jobs {
        if let Ok(f) = j.await {
            out.push(f);
        }
    }
    out
}

#[cfg(windows)]
mod platform {
    use windows::core::HSTRING;
    use windows::Foundation::Uri;
    use windows::Web::Http::HttpClient;

    pub fn get(url: &str) -> Result<String, String> {
        let uri = Uri::CreateUri(&HSTRING::from(url)).map_err(|e| e.message().to_string())?;
        let client = HttpClient::new().map_err(|e| e.message().to_string())?;
        let body = client
            .GetStringAsync(&uri)
            .and_then(|op| op.join())
            .map_err(|e| e.message().to_string())?;
        Ok(body.to_string())
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn get(url: &str) -> Result<String, String> {
        Err(format!("fetching {url} is only available on Windows"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_links() {
        assert_eq!(
            normalise("webcal://x.com/a.ics").as_deref(),
            Some("https://x.com/a.ics")
        );
        assert_eq!(
            normalise(" https://x.com/a.ics ").as_deref(),
            Some("https://x.com/a.ics")
        );
        assert_eq!(normalise("file:///c:/a.ics"), None);
    }
}
