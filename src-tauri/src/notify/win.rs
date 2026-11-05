use base64::Engine as _;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::core::Interface;
use windows::Foundation::Size;
use windows::Storage::Streams::{DataReader, IInputStream};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus as St,
};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};

use super::{diff, split_text, Access, Notice, NoticeState};
use crate::events;

const MAX_ITEMS: usize = 50;
const MAX_ICON_BYTES: u64 = 1024 * 1024;

pub fn run(app: AppHandle, state: Arc<Mutex<NoticeState>>) {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let Ok(listener) = UserNotificationListener::Current() else {
        set_access(&app, &state, Access::Unsupported);
        return;
    };
    let mut seen: HashSet<u32> = HashSet::new();
    let mut first = true;
    let mut icons: HashMap<String, Option<String>> = HashMap::new();
    let mut asked = false;
    let mut poll_failed = false;
    loop {
        let status = listener.GetAccessStatus().unwrap_or(St::Unspecified);
        let status = if status == St::Unspecified && !asked {
            asked = true;
            listener
                .RequestAccessAsync()
                .and_then(|op| op.join())
                .unwrap_or(St::Unspecified)
        } else {
            status
        };
        if status != St::Allowed {
            set_access(&app, &state, Access::Denied);
            seen.clear();
            first = true;
            std::thread::sleep(Duration::from_secs(5));
            continue;
        }
        set_access(&app, &state, Access::Allowed);

        match poll(&listener) {
            Ok(list) => {
                let ids: Vec<u32> = list.iter().filter_map(|n| n.Id().ok()).collect();
                let (added, removed) = diff(&seen, &ids);
                if !added.is_empty() || !removed.is_empty() || first {
                    let mut st = state.lock();
                    st.items.retain(|n| !removed.contains(&n.id));
                    for n in list
                        .iter()
                        .filter(|n| n.Id().map(|i| added.contains(&i)).unwrap_or(false))
                    {
                        if let Some(notice) = read(n, &mut icons) {
                            if !first {
                                let _ = app.emit(events::NOTIFY_NEW, &notice);
                            }
                            st.items.push(notice);
                        }
                    }
                    st.items.sort_by_key(|n| std::cmp::Reverse(n.at_ms));
                    st.items.truncate(MAX_ITEMS);
                    let _ = app.emit(events::NOTIFY_CHANGED, &*st);
                }
                seen = ids.into_iter().collect();
                first = false;
            }
            Err(e) => {
                if !poll_failed {
                    log::warn!("notify: reading notifications failed: {e}");
                    poll_failed = true;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(1000));
    }
}

fn set_access(app: &AppHandle, state: &Arc<Mutex<NoticeState>>, access: Access) {
    let mut st = state.lock();
    if st.access != access {
        log::info!("notify: access {access:?}");
        st.access = access;
        if access != Access::Allowed {
            st.items.clear();
        }
        let _ = app.emit(events::NOTIFY_CHANGED, &*st);
    }
}

fn poll(l: &UserNotificationListener) -> windows::core::Result<Vec<UserNotification>> {
    let v = l.GetNotificationsAsync(NotificationKinds::Toast)?.join()?;
    Ok(v.into_iter().collect())
}

fn read(n: &UserNotification, icons: &mut HashMap<String, Option<String>>) -> Option<Notice> {
    let id = n.Id().ok()?;
    let info = n.AppInfo().ok();
    let app_id = info
        .as_ref()
        .and_then(|i| i.AppUserModelId().ok())
        .map(|s| s.to_string())
        .unwrap_or_default();
    let display = info.as_ref().and_then(|i| i.DisplayInfo().ok());
    let app = display
        .as_ref()
        .and_then(|d| d.DisplayName().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| app_id.clone());
    let texts: Vec<String> = n
        .Notification()
        .and_then(|t| t.Visual())
        .and_then(|v| v.GetBinding(&KnownNotificationBindings::ToastGeneric()?))
        .and_then(|b| b.GetTextElements())
        .map(|els| {
            els.into_iter()
                .filter_map(|e| e.Text().ok())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();
    let (title, body) = split_text(&texts);
    if title.is_empty() && body.is_empty() {
        return None;
    }
    let icon = icons
        .entry(app_id.clone())
        .or_insert_with(|| display.as_ref().and_then(|d| logo(d).ok().flatten()))
        .clone();
    // DateTime ticks (100 ns since 1601) → unix ms.
    let at_ms = n
        .CreationTime()
        .map(|t| ((t.UniversalTime - 116_444_736_000_000_000) / 10_000).max(0) as u64)
        .unwrap_or_else(|_| crate::util::now_ms());
    Some(Notice {
        id,
        app,
        app_id,
        title,
        body,
        icon,
        at_ms,
    })
}

fn logo(d: &windows::ApplicationModel::AppDisplayInfo) -> windows::core::Result<Option<String>> {
    let stream = d
        .GetLogo(Size {
            Width: 64.0,
            Height: 64.0,
        })?
        .OpenReadAsync()?
        .join()?;
    let size = stream.Size()?;
    if size == 0 || size > MAX_ICON_BYTES {
        return Ok(None);
    }
    let mime = stream
        .ContentType()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let input: IInputStream = stream.cast()?;
    let reader = DataReader::CreateDataReader(&input)?;
    let read = reader.LoadAsync(size as u32)?.join()?;
    let mut buf = vec![0u8; read as usize];
    reader.ReadBytes(&mut buf)?;
    let mime = if mime.starts_with("image/") {
        mime
    } else {
        "image/png".into()
    };
    Ok(Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&buf)
    )))
}

/// Remove one notification from the Action Center, or all of them.
pub fn dismiss(id: Option<u32>) {
    std::thread::spawn(move || {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        if let Ok(l) = UserNotificationListener::Current() {
            let _ = match id {
                Some(id) => l.RemoveNotification(id),
                None => l.ClearNotifications(),
            };
        }
    });
}
