import { useEffect, useState } from "react";
import { getGitDiff, getGitLog, getGitStatus, restoreGitCheckpoint, type GitLogEntry, type GitStatus } from "./api.js";

interface GitPanelProps {
  projectId: string;
  /** Bumped by the parent whenever a chat run completes, to trigger a refresh (e.g. after a checkpoint commit). */
  refreshSignal: number;
}

export function GitPanel({ projectId, refreshSignal }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const [statusResult, logResult] = await Promise.all([getGitStatus(projectId), getGitLog(projectId, 10)]);
      setStatus(statusResult);
      setLog(logResult);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshSignal]);

  async function handleShowDiff() {
    try {
      const result = await getGitDiff(projectId);
      setDiff(result.diff || "(no unstaged changes)");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRestore(hash: string) {
    const confirmed = window.confirm(
      `Restore checkpoint ${hash.slice(0, 8)}? This hard-resets the working tree — any uncommitted changes since this commit will be lost.`,
    );
    if (!confirmed) return;
    setRestoring(hash);
    try {
      await restoreGitCheckpoint(projectId, hash);
      await refresh();
      setDiff(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoring(null);
    }
  }

  if (!status) {
    return (
      <section className="panel">
        <h2>Git</h2>
        {error ? <p className="error">{error}</p> : <p className="context-summary">Loading…</p>}
      </section>
    );
  }

  if (!status.isRepo) {
    return (
      <section className="panel">
        <h2>Git</h2>
        <p className="context-summary">Not a git repository.</p>
      </section>
    );
  }

  const dirtyCount = status.staged.length + status.unstaged.length + status.untracked.length;

  return (
    <section className="panel">
      <h2>Git</h2>
      <p className="context-summary">
        Branch <strong>{status.branch}</strong> — {dirtyCount === 0 ? "clean" : `${dirtyCount} changed file(s)`}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="mode-buttons">
        <button onClick={refresh}>Refresh</button>
        <button onClick={handleShowDiff} disabled={dirtyCount === 0}>
          View diff
        </button>
      </div>
      {diff != null && <pre className="context-summary git-diff">{diff}</pre>}

      <h2 style={{ marginTop: "10px" }}>Checkpoints</h2>
      <ul className="git-log">
        {log.map((entry) => (
          <li key={entry.hash}>
            <div className="git-log-message">{entry.message}</div>
            <div className="git-log-meta">
              <code>{entry.hash.slice(0, 8)}</code> · {entry.author}
            </div>
            <button onClick={() => handleRestore(entry.hash)} disabled={restoring === entry.hash}>
              {restoring === entry.hash ? "Restoring…" : "Restore"}
            </button>
          </li>
        ))}
        {log.length === 0 && <li className="context-summary">No commits yet.</li>}
      </ul>
    </section>
  );
}
