// GameForge desktop shell: a thin Tauri webview around the React UI in
// apps/desktop/src. All real work (LLM calls, tool execution, project
// scanning) happens in the Node sidecar (apps/server) over REST/WebSocket —
// this crate has no application logic of its own yet. Native Tauri
// commands can be added here later for capabilities the web platform
// can't reach (native file dialogs, OS credential storage, etc.).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running GameForge");
}
