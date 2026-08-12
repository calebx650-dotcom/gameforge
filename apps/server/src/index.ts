import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { ProjectManager } from "./project-manager.js";
import { createRouter } from "./routes.js";
import { handleChatConnection } from "./chat-socket.js";

const PORT = Number(process.env.GAMEFORGE_SERVER_PORT ?? 4310);

export function createApp() {
  const projects = new ProjectManager();
  const app = express();
  // GameForge's server only ever binds to localhost and is only ever
  // talked to by the desktop shell's own webview, so an open CORS policy
  // here does not expose it to the wider web.
  app.use(cors());
  app.use(express.json());
  app.use("/api", createRouter(projects));
  return { app, projects };
}

export function startServer(port = PORT) {
  const { app, projects } = createApp();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/chat" });

  wss.on("connection", (socket) => handleChatConnection(socket, projects));

  httpServer.listen(port, () => {
    // Log the OS-assigned port from the actual bound address, not the `port` parameter —
    // when `port` is 0 (ask the OS for any free port, e.g. GAMEFORGE_SERVER_PORT=0 for a
    // test spawning its own throwaway server instance), the parameter itself is always 0;
    // only `httpServer.address()` after listen's callback fires knows the real port.
    const address = httpServer.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    console.log(`GameForge server listening on http://localhost:${boundPort}`);
  });

  return httpServer;
}

// Naively comparing `import.meta.url` against `file://${process.argv[1]}` (the previous
// approach) never matches on Windows: argv[1] uses backslashes and isn't percent-encoded
// (`C:\Users\...\index.ts`), while import.meta.url is a real file:// URL with forward
// slashes, a triple slash before the drive letter, and spaces percent-encoded
// (`file:///C:/Users/...`) — confirmed live 2026-08-11: `npm run dev:server` started the
// process and compiled cleanly with no error, but this check was always false, so
// `startServer()` was never called and the process just sat there watching files, never
// listening on anything (no error, no log line — indistinguishable from a hang without
// tracing it). `pathToFileURL` builds the same kind of URL Node itself used for
// `import.meta.url`, so the comparison actually matches. (Independently found and fixed
// the same way in an earlier uncommitted session, 2026-08-10.)
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer();
}
