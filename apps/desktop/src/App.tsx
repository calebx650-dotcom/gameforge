import { useRef, useState } from "react";
import type { AgentMode, ModelInfo, OperationLogEntry, ToolCall } from "@gameforge/shared";
import { ChatSocket, listModels, openProject, type ProjectSummary } from "./api.js";
import { GitPanel } from "./GitPanel.js";

const PROVIDERS = ["ollama", "openai", "openrouter", "anthropic", "openai-compatible"] as const;
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

  const [mode, setMode] = useState<AgentMode>("assist");
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [log, setLog] = useState<OperationLogEntry[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [busy, setBusy] = useState(false);
  const [gitRefreshSignal, setGitRefreshSignal] = useState(0);
  const [streamingText, setStreamingText] = useState("");

  const [engine, setEngine] = useState<string>("none");
  const [engineUrl, setEngineUrl] = useState("");

  const socketRef = useRef<ChatSocket | null>(null);

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

  function handleSend() {
    if (!project || !model || !prompt.trim() || busy) return;
    setBusy(true);
    setChat((prev) => [...prev, { role: "user", text: prompt }]);
    setLog([]);
    setStreamingText("");

    const socket = new ChatSocket({
      onOpen: () => {
        socket.sendChat({
          projectId: project.id,
          mode,
          providerSettings: { provider, model, baseUrl: baseUrl || undefined, apiKey: apiKey || undefined },
          message: prompt,
          engineSettings: engine !== "none" ? { engine, url: engineUrl || undefined } : undefined,
          stream: true,
        });
      },
      onLog: (entry) => setLog((prev) => [...prev, entry]),
      onApprovalRequest: (requestId, toolCall, reason) => setPendingApproval({ requestId, toolCall, reason }),
      onStreamDelta: (text) => setStreamingText((prev) => prev + text),
      onResult: ({ stoppedReason, iterations, finalText }) => {
        setChat((prev) => [
          ...prev,
          { role: "assistant", text: finalText || `(stopped: ${stoppedReason} after ${iterations} iteration(s))` },
        ]);
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

            <div className="chat-input">
              <textarea
                placeholder="Describe what you want GameForge to build or change…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={busy}
              />
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
          </section>
        </main>
      </div>
    </div>
  );
}
