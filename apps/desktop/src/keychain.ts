/**
 * Thin wrapper around the native `keychain_*` Tauri commands
 * (apps/desktop/src-tauri/src/lib.rs), which store credentials in the real
 * OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret
 * Service/keyutils) via the `keyring` crate — something the web platform
 * has no access to on its own.
 *
 * This module is safe to import and call from the plain browser-tab dev
 * mode (`npm run dev:desktop`), not just the native Tauri window: outside
 * Tauri, `window.__TAURI_INTERNALS__` doesn't exist, `invoke()` throws
 * immediately, and every function here resolves to a harmless no-op
 * (`isAvailable()` returns false, `get()` resolves to `null`) instead of
 * crashing the UI.
 */

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isKeychainAvailable(): boolean {
  return isTauri();
}

export async function keychainGet(account: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("keychain_get", { account });
}

export async function keychainSet(account: string, secret: string): Promise<void> {
  if (!isTauri()) throw new Error("OS keychain is only available in the native desktop app, not the browser dev mode.");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("keychain_set", { account, secret });
}

export async function keychainDelete(account: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("keychain_delete", { account });
}

/**
 * Tauri's invoke() rejects with whatever the Rust command's `Err` value
 * was — for these commands, a plain string (`Result<T, String>`), not a JS
 * `Error` instance. `(err as Error).message` on a plain string rejection
 * is `undefined`; this normalizes any rejection shape into readable text.
 */
export function keychainErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
