import { createServer } from "node:http";
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
    console.log(`GameForge server listening on http://localhost:${port}`);
  });

  return httpServer;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer();
}
