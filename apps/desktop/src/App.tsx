import { useEffect, useRef, useState } from "react";
import type { AgentMode, ModelInfo, OperationLogEntry, ToolCall } from "@gameforge/shared";
import { ChatSocket, listModels, openProject, type ProjectSummary, type TaskPlan } from "./api.js";
import { GitPanel } from "./GitPanel.js";
import { isKeychainAvailable, keychainDelete, keychainErrorMessage, keychainGet, keychainSet } from "./keychain.js";
import { deriveBuildAttempts, deriveFilesChanged } from "./build-status.js";

const PROVIDERS = ["ollama", "openai", "openrouter", "anthropic", "gemini", "openai-compatible"] as const;
const MODES: AgentMode[] = ["ask", "assist", "build", "autonomous"];
const ENGINES = ["none", "unity", "godot"] as const;

interface PendingApproval {
  requestId: string;
  toolCall: ToolCall;
  reason: string;
}

interface ChatEntry {
  role: "user" | "assistant" | "activity";
  text: string;
}

export function App() {
  const [projectPath, setProjectPath] = useState("");
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);

  const [provider, setProvider] = useState<string>("ollama");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:11434");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [keychainMessage, setKeychainMessage] = useState<string | null>(null);
  const keychainAvailable = isKeychainAvailable();

  // Switching providers loads whatever key was previously saved to the OS
  // keychain for that provider (native Tauri window only — a no-op in the
  // plain browser dev-mode tab), replacing whatever was in the field —
  // including clearing it when the new provider has no saved key, so a key
  // typed for the previous provider never lingers and looks like it
  // applies to this one.
  useEffect(() => {
    if (!keychainAvailable) return;
    let cancelled = false;
    keychainGet(`llm:${provider}`).then((saved) => {
      if (!cancelled) setApiKey(saved ?? "");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  async function handleSaveApiKey() {
    setKeychainMessage(null);
    try {
      await keychainSet(`llm:${provider}`, apiKey);
      setKeychainMessage(`Saved to OS keychain for "${provider}".`);
    } catch (err) {
      setKeychainMessage(`Failed to save: ${keychainErrorMessage(err)}`);
    }
  }

  async function handleForgetApiKey() {
    setKeychainMessage(null);
    try {
      await keychainDelete(`llm:${provider}`);
      setKeychainMessage(`Removed the saved key for "${provider}".`);
    } catch (err) {
      setKeychainMessage(`Failed to remove: ${keychainErrorMessage(err)}`);
    }
  }

  const [mode, setMode] = useState<AgentMode>("assist");
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [log, setLog] = useState<OperationLogEntry[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [busy, setBusy] = useState(false);
  const [gitRefreshSignal, setGitRefreshSignal] = useState(0);
  const [streamingText, setStreamingText] = useState("");
  const [attachedImage, setAttachedImage] = useState<{ data: string; mimeType: string; previewUrl: string } | null>(null);
  const [attachedVideo, setAttachedVideo] = useState<{ data: string; mimeType: string; fileName: string } | null>(null);

  const [engine, setEngine] = useState<string>("none");
  const [engineUrl, setEngineUrl] = useState("");

  const [lastResult, setLastResult] = useState<{ finalText: string; stoppedReason: string; iterations: number; taskPlan: TaskPlan } | null>(
    null,
  );

  const socketRef = useRef<ChatSocket | null>(null);

  const buildAttempts = deriveBuildAttempts(log);
  const filesChanged = deriveFilesChanged(log);
  const latestBuild = buildAttempts[buildAttempts.length - 1];
  const buildStatus: "idle" | "building" | "failed" | "fixing" | "success" = !latestBuild
    ? "idle"
    : latestBuild.status === "building"
      ? "building"
      : latestBuild.status === "success"
        ? "success"
        : busy
          ? "fixing"
          : "failed";

  async function handleOpenProject() {
    setProjectError(null);
    try {
      const summary = await openProject(projectPath);
      setProject(summary);
    } catch (err) {
      setProjectError((err as Error).message);
    }
  }

  async function handleRefreshModels() {
    setModelsError(null);
    try {
      const list = await listModels({ provider, baseUrl, apiKey: apiKey || undefined });
      setModels(list);
      if (list.length && !model) setModel(list[0].id);
    } catch (err) {
      setModelsError((err as Error).message);
    }
  }

  function handleAttachImage(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const commaIndex = dataUrl.indexOf(",");
      setAttachedImage({ data: dataUrl.slice(commaIndex + 1), mimeType: file.type || "image/png", previewUrl: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  function handleAttachVideo(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const commaIndex = dataUrl.indexOf(",");
      setAttachedVideo({ data: dataUrl.slice(commaIndex + 1), mimeType: file.type || "video/mp4", fileName: file.name });
    };
    reader.readAsDataURL(file);
  }

  function handleSend() {
    if (!project || !model || !prompt.trim() || busy) return;
    setBusy(true);
    const attachmentNote = [attachedImage && "1 reference image", attachedVideo && "1 reference video"].filter(Boolean).join(" + ");
    setChat((prev) => [...prev, { role: "user", text: attachmentNote ? `${prompt} [+ ${attachmentNote}]` : prompt }]);
    setLog([]);
    setStreamingText("");
    setLastResult(null);
    const imagesForThisMessage = attachedImage ? [{ data: attachedImage.data, mimeType: attachedImage.mimeType }] : undefined;
    const videoForThisMessage = attachedVideo ? { data: attachedVideo.data, mimeType: attachedVideo.mimeType } : undefined;

    const socket = new ChatSocket({
      onOpen: () => {
        socket.sendChat({
          projectId: project.id,
          mode,
          providerSettings: { provider, model, baseUrl: baseUrl || undefined, apiKey: apiKey || undefined },
          message: prompt,
          engineSettings: engine !== "none" ? { engine, url: engineUrl || undefined } : undefined,
          stream: true,
          images: imagesForThisMessage,
          referenceVideo: videoForThisMessage,
        });
      },
      onLog: (entry) => setLog((prev) => [...prev, entry]),
      onApprovalRequest: (requestId, toolCall, reason) => setPendingApproval({ requestId, toolCall, reason }),
      onStreamDelta: (text) => setStreamingText((prev) => prev + text),
      onResult: ({ stoppedReason, iterations, finalText, taskPlan }) => {
        setChat((prev) => [
          ...prev,
          { role: "assistant", text: finalText || `(stopped: ${stoppedReason} after ${iterations} iteration(s))` },
        ]);
        setLastResult({ finalText, stoppedReason, iterations, taskPlan });
        setStreamingText("");
        setBusy(false);
        setGitRefreshSignal((n) => n + 1);
        socket.close();
      },
      onError: (message) => {
        setChat((prev) => [...prev, { role: "activity", text: `Error: ${message}` }]);
        setStreamingText("");
        setBusy(false);
        setGitRefreshSignal((n) => n + 1);
        socket.close();
      },
    });
    socketRef.current = socket;
    setPrompt("");
    setAttachedImage(null);
    setAttachedVideo(null);
  }

  function respondApproval(approved: boolean) {
    if (!pendingApproval) return;
    socketRef.current?.respondApproval(pendingApproval.requestId, approved);
    setPendingApproval(null);
  }

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">GameForge</span>
        <span className="mode-badge" data-mode={mode}>
          {mode.toUpperCase()}
        </span>
        {buildStatus !== "idle" && (
          <span className="build-badge" data-status={buildStatus} data-testid="build-status-badge">
            {buildStatus === "building" && `BUILDING (attempt ${latestBuild.attempt})`}
            {buildStatus === "fixing" && `FIXING (after attempt ${latestBuild.attempt})`}
            {buildStatus === "failed" && `BUILD FAILED (attempt ${latestBuild.attempt})`}
            {buildStatus === "success" && `BUILD SUCCESS (attempt ${latestBuild.attempt})`}
          </span>
        )}
      </header>

      <div className="layout">
        <aside className="sidebar">
          <section className="panel">
            <h2>Project</h2>
            <input
              placeholder="/path/to/game/project"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
            />
            <button onClick={handleOpenProject}>Open Project</button>
            {projectError && <p className="error">{projectError}</p>}
            {project && (
              <pre className="context-summary">{project.contextSummary}</pre>
            )}
          </section>

          <section className="panel">
            <h2>Provider</h2>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input placeholder="Base URL (optional)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            <input
              placeholder="API key (optional)"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {keychainAvailable ? (
              <div className="keychain-controls">
                <button onClick={handleSaveApiKey} disabled={!apiKey}>
                  Save to OS Keychain
                </button>
                <button onClick={handleForgetApiKey}>Forget</button>
              </div>
            ) : (
              <p className="context-summary">
                OS keychain storage is only available in the native desktop app (not this browser tab) — keys here are
                session-only.
              </p>
            )}
            {keychainMessage && <p className="context-summary">{keychainMessage}</p>}
            <button onClick={handleRefreshModels}>Refresh Models</button>
            {modelsError && <p className="error">{modelsError}</p>}
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Select a model…</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label ?? m.id}
                </option>
              ))}
            </select>
          </section>

          <section className="panel">
            <h2>Agent Mode</h2>
            <div className="mode-buttons">
              {MODES.map((m) => (
                <button key={m} className={m === mode ? "active" : ""} onClick={() => setMode(m)}>
                  {m}
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Engine Bridge</h2>
            <select value={engine} onChange={(e) => setEngine(e.target.value)}>
              {ENGINES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            {engine !== "none" && (
              <input
                placeholder={engine === "unity" ? "http://127.0.0.1:6400 (default)" : "ws://127.0.0.1:6401 (default)"}
                value={engineUrl}
                onChange={(e) => setEngineUrl(e.target.value)}
              />
            )}
            {engine !== "none" && (
              <p className="context-summary">
                Scene/object/play-mode/screenshot tools become available. Requires a running {engine === "unity" ? "unity-mcp" : "Godot bridge plugin"} server.
              </p>
            )}
          </section>

          {project && <GitPanel projectId={project.id} refreshSignal={gitRefreshSignal} />}
        </aside>

        <main className="main">
          <section className="chat-panel">
            <div className="chat-log">
              {chat.map((entry, i) => (
                <div key={i} className={`chat-entry chat-entry--${entry.role}`}>
                  <span className="chat-role">{entry.role}</span>
                  <span>{entry.text}</span>
                </div>
              ))}
              {busy && streamingText && (
                <div className="chat-entry chat-entry--assistant chat-entry--streaming" data-testid="streaming-entry">
                  <span className="chat-role">assistant</span>
                  <span>{streamingText}</span>
                </div>
              )}
            </div>

            {pendingApproval && (
              <div className="approval-box">
                <p>
                  Approval needed: <code>{pendingApproval.toolCall.name}</code> — {pendingApproval.reason}
                </p>
                <pre>{JSON.stringify(pendingApproval.toolCall.arguments, null, 2)}</pre>
                <button onClick={() => respondApproval(true)}>Approve</button>
                <button onClick={() => respondApproval(false)}>Deny</button>
              </div>
            )}

            {attachedImage && (
              <div className="attached-image-preview" data-testid="attached-image-preview">
                <img src={attachedImage.previewUrl} alt="Attached reference" />
                <button onClick={() => setAttachedImage(null)} disabled={busy}>
                  Remove
                </button>
              </div>
            )}
            {attachedVideo && (
              <div className="attached-video-preview" data-testid="attached-video-preview">
                <span>🎬 {attachedVideo.fileName}</span>
                <button onClick={() => setAttachedVideo(null)} disabled={busy}>
                  Remove
                </button>
              </div>
            )}
            <div className="chat-input">
              <textarea
                placeholder="Describe what you want GameForge to build or change…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={busy}
              />
              <label className="attach-image-button">
                Attach
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => handleAttachImage(e.target.files?.[0])}
                  style={{ display: "none" }}
                />
              </label>
              <label className="attach-video-button" title="Attach a short reference video — sampled down to a few frames (requires ffmpeg on the server host)">
                Attach video
                <input
                  type="file"
                  accept="video/*"
                  disabled={busy}
                  onChange={(e) => handleAttachVideo(e.target.files?.[0])}
                  style={{ display: "none" }}
                />
              </label>
              <button onClick={handleSend} disabled={busy || !project || !model}>
                {busy ? "Working…" : "Send"}
              </button>
            </div>
          </section>

          <section className="activity-panel">
            <h2>Tool Activity</h2>
            <ul>
              {log.map((entry, i) => (
                <li key={i} className={`log-${entry.kind}`}>
                  <span className="log-kind">{entry.kind}</span> {entry.summary}
                </li>
              ))}
            </ul>

            {buildAttempts.length > 0 && (
              <div className="build-attempts" data-testid="build-attempts">
                <h3>Build Attempts</h3>
                <ul>
                  {buildAttempts.map((a) => (
                    <li key={a.attempt} className={`build-attempt build-attempt--${a.status}`}>
                      Attempt {a.attempt}: {a.status === "building" ? "building…" : a.status}
                      {a.errors && a.errors.length > 0 && (
                        <ul className="build-errors">
                          {a.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {filesChanged.length > 0 && (
              <div className="files-changed" data-testid="files-changed">
                <h3>Files Changed</h3>
                <ul>
                  {filesChanged.map((f, i) => (
                    <li key={i}>
                      <span className="file-tool">{f.tool}</span> {f.path}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {lastResult && (
              <div className="final-result" data-testid="final-result">
                <h3>Final Result</h3>
                <p className="final-result-status">
                  Stopped: {lastResult.stoppedReason} after {lastResult.iterations} iteration(s)
                </p>
                {lastResult.finalText && <p className="final-result-text">{lastResult.finalText}</p>}

                {lastResult.taskPlan.plan.length > 0 && (
                  <div className="task-plan" data-testid="task-plan">
                    <h4>Plan</h4>
                    <ol>
                      {lastResult.taskPlan.plan.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {lastResult.taskPlan.requirements.length > 0 && (
                  <div className="requirements" data-testid="requirements">
                    <h4>Requirements</h4>
                    <ul>
                      {lastResult.taskPlan.requirements.map((r) => (
                        <li key={r.id} className={`requirement requirement--${r.status}`}>
                          <span className="requirement-status">{r.status}</span> {r.description}
                          {r.note && <span className="requirement-note"> — {r.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
