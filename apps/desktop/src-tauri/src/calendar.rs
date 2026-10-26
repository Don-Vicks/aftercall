//! Reads the macOS calendar (EventKit) so a recording can take its meeting's name
//! and the recap can go to the people invited. Read-only; nothing is written back.
//! Picking the right event and matching names to emails happens in @aftercall/core.

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Attendee {
    /// Empty when the calendar has no name for them.
    pub name: String,
    /// Empty when the invite has no email address.
    pub email: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub title: String,
    /// Unix seconds.
    pub start: i64,
    pub end: i64,
    pub all_day: bool,
    /// Everyone invited except the user themself, rooms and resources.
    pub attendees: Vec<Attendee>,
}

/// The email in a participant URL ("mailto:ada@example.com"); None for other schemes.
fn email_from_url(url: &str) -> Option<String> {
    let rest = url.get(..7).filter(|s| s.eq_ignore_ascii_case("mailto:")).map(|_| &url[7..])?;
    let email = rest.split('?').next().unwrap_or_default().trim();
    email.contains('@').then(|| email.to_string())
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{Attendee, CalendarEvent, email_from_url};
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStatus, EKEventStore, EKParticipantType};
    use objc2_foundation::{NSDate, NSError};

    pub fn status() -> &'static str {
        let status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
        if status == EKAuthorizationStatus::FullAccess {
            "granted"
        } else if status == EKAuthorizationStatus::NotDetermined {
            "not-asked"
        } else {
            // Denied, restricted by a profile, or add-events-only: all mean we can't read.
            "denied"
        }
    }

    /// Shows the macOS prompt (only the first time) and waits for the answer.
    pub fn request_access() -> Result<bool, String> {
        let (tx, rx) = std::sync::mpsc::channel();
        let store = unsafe { EKEventStore::new() };
        let done = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        unsafe { store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&done)) };
        rx.recv_timeout(std::time::Duration::from_secs(300)).map_err(|_| "No answer from macOS".to_string())
    }

    pub fn events_between(start: i64, end: i64) -> Vec<CalendarEvent> {
        // A fresh store each time: one made before access was granted stays empty.
        let store = unsafe { EKEventStore::new() };
        let from = NSDate::dateWithTimeIntervalSince1970(start as f64);
        let to = NSDate::dateWithTimeIntervalSince1970(end as f64);
        let events = unsafe {
            let predicate = store.predicateForEventsWithStartDate_endDate_calendars(&from, &to, None);
            store.eventsMatchingPredicate(&predicate)
        };
        events
            .iter()
            .filter(|e| unsafe { e.status() } != EKEventStatus::Canceled)
            .map(|e| unsafe {
                let attendees = e
                    .attendees()
                    .map(|list| {
                        list.iter()
                            .filter(|p| !p.isCurrentUser())
                            .filter(|p| matches!(p.participantType(), EKParticipantType::Person | EKParticipantType::Unknown))
                            .map(|p| Attendee {
                                name: p.name().map(|n| n.to_string()).unwrap_or_default().trim().to_string(),
                                email: p.URL().absoluteString().and_then(|u| email_from_url(&u.to_string())).unwrap_or_default(),
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                CalendarEvent {
                    title: e.title().to_string().trim().to_string(),
                    start: e.startDate().timeIntervalSince1970() as i64,
                    end: e.endDate().timeIntervalSince1970() as i64,
                    all_day: e.isAllDay(),
                    attendees,
                }
            })
            .collect()
    }
}

#[cfg(not(target_os = "macos"))]
mod mac {
    use super::CalendarEvent;
    pub fn status() -> &'static str {
        "denied"
    }
    pub fn request_access() -> Result<bool, String> {
        Ok(false)
    }
    pub fn events_between(_start: i64, _end: i64) -> Vec<CalendarEvent> {
        vec![]
    }
}

/// "not-asked", "denied" or "granted".
#[tauri::command]
pub fn calendar_status() -> &'static str {
    mac::status()
}

/// Asks macOS for calendar access. Returns whether it was granted.
#[tauri::command]
pub async fn calendar_request_access() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(mac::request_access).await.map_err(|e| e.to_string())?
}

/// Calendar events that overlap `start..end` (Unix seconds). Empty without access.
#[tauri::command]
pub async fn calendar_events_between(start: i64, end: i64) -> Result<Vec<CalendarEvent>, String> {
    if end < start || mac::status() != "granted" {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || mac::events_between(start, end)).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::email_from_url;

    #[test]
    fn reads_the_email_from_a_mailto_url() {
        assert_eq!(email_from_url("mailto:ada@example.com").as_deref(), Some("ada@example.com"));
        assert_eq!(email_from_url("MAILTO:ada@example.com?subject=x").as_deref(), Some("ada@example.com"));
    }

    #[test]
    fn ignores_urls_without_an_email() {
        assert_eq!(email_from_url("urn:uuid:1234"), None);
        assert_eq!(email_from_url("mailto:"), None);
        assert_eq!(email_from_url("http://example.com"), None);
    }
}
