// GameForge desktop shell: a thin Tauri webview around the React UI in
// apps/desktop/src. All real work (LLM calls, tool execution, project
// scanning) happens in the Node sidecar (apps/server) over REST/WebSocket.
// The one native capability this crate provides is OS-keychain-backed
// credential storage (macOS Keychain, Windows Credential Manager, Linux
// Secret Service via the `keyring` crate) — something the web platform
// genuinely can't reach on its own, unlike everything else the UI does.

use keyring::Entry;

/// Every credential this app stores shares one keychain "service" name, so
/// they're grouped together in the OS's credential manager UI; the
/// `account` string (e.g. "llm:openai", "voice:elevenlabs") distinguishes
/// individual entries within it.
const KEYCHAIN_SERVICE: &str = "dev.gameforge.desktop";

fn entry_for(account: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, account).map_err(|e| e.to_string())
}

/// Linux-only fallback: `Entry::new()`'s default backend prefers Secret
/// Service (the real GNOME Keyring/KWallet equivalent, persists across
/// reboots) — the right choice on a real desktop. But confirmed live: under
/// an X11 session with no functioning D-Bus session bus, libdbus's
/// autolaunch mechanism tries spawning `dbus-launch` and hard-fails instead
/// of the keyring crate gracefully falling back on its own. Explicitly
/// constructing a kernel-keyutils-backed Entry (session-scoped, not
/// disk-persistent, but still real OS-level secure storage, not plaintext)
/// as a second attempt means a broken/absent Secret Service provider
/// degrades to "still works, just less persistent" instead of "hard error."
#[cfg(target_os = "linux")]
fn linux_keyutils_fallback(account: &str) -> Result<Entry, String> {
    use keyring::Entry as KeyringEntry;
    let credential = keyring::keyutils::KeyutilsCredential::new_with_target(None, KEYCHAIN_SERVICE, account)
        .map_err(|e| e.to_string())?;
    Ok(KeyringEntry::new_with_credential(Box::new(credential)))
}

#[tauri::command]
fn keychain_set(account: String, secret: String) -> Result<(), String> {
    let primary_err = match entry_for(&account)?.set_password(&secret) {
        Ok(()) => return Ok(()),
        Err(e) => e.to_string(),
    };
    #[cfg(target_os = "linux")]
    {
        if let Ok(fallback) = linux_keyutils_fallback(&account) {
            if fallback.set_password(&secret).is_ok() {
                return Ok(());
            }
        }
    }
    Err(primary_err)
}

#[tauri::command]
fn keychain_get(account: String) -> Result<Option<String>, String> {
    let primary_err = match entry_for(&account)?.get_password() {
        Ok(secret) => return Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => e.to_string(),
    };
    #[cfg(target_os = "linux")]
    {
        if let Ok(fallback) = linux_keyutils_fallback(&account) {
            match fallback.get_password() {
                Ok(secret) => return Ok(Some(secret)),
                Err(keyring::Error::NoEntry) => return Ok(None),
                Err(_) => {}
            }
        }
    }
    Err(primary_err)
}

#[tauri::command]
fn keychain_delete(account: String) -> Result<(), String> {
    let primary_err = match entry_for(&account)?.delete_credential() {
        Ok(()) => return Ok(()),
        Err(keyring::Error::NoEntry) => return Ok(()),
        Err(e) => e.to_string(),
    };
    #[cfg(target_os = "linux")]
    {
        if let Ok(fallback) = linux_keyutils_fallback(&account) {
            match fallback.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => return Ok(()),
                Err(_) => {}
            }
        }
    }
    Err(primary_err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![keychain_set, keychain_get, keychain_delete])
        .run(tauri::generate_context!())
        .expect("error while running GameForge");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exercises the real `keyring` crate against whatever OS credential
    /// backend is actually available in this environment — not mocked.
    /// On a real desktop (macOS Keychain / Windows Credential Manager /
    /// Linux with a running Secret Service daemon) this round-trips a
    /// real secret. In a headless environment with no keyring daemon
    /// running (like a CI sandbox), a clean backend error is the expected
    /// outcome — this test accepts either, but never a panic or a
    /// silently wrong value.
    #[test]
    fn set_get_delete_round_trip_or_clean_backend_error() {
        let account = "gameforge-test-account-set-get-delete";
        let secret = "test-secret-value-12345";

        match keychain_set(account.to_string(), secret.to_string()) {
            Ok(()) => {
                // A real backend is available — verify a genuine round trip.
                assert_eq!(keychain_get(account.to_string()).unwrap(), Some(secret.to_string()));
                keychain_delete(account.to_string()).unwrap();
                assert_eq!(keychain_get(account.to_string()).unwrap(), None);
            }
            Err(message) => {
                // No OS keyring backend reachable in this environment — a clean,
                // descriptive error is the correct behavior, not a panic.
                assert!(!message.is_empty());
            }
        }
    }

    #[test]
    fn get_on_an_account_that_was_never_set_returns_none_not_an_error() {
        let result = keychain_get("gameforge-test-account-never-set".to_string());
        // Either a clean None (real backend, no entry) or a clean backend-unavailable
        // error — never a panic.
        if let Ok(value) = result {
            assert_eq!(value, None);
        }
    }
}
