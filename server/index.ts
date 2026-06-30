import path from "node:path";
import http from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createApiRouter } from "./routes.js";
import { assertServerConfig, config } from "./config.js";
import { createSocketServer } from "./socket.js";
import type { ChatMessage } from "../shared/types.js";

assertServerConfig();

const app = express();
const server = http.createServer(app);
const io = createSocketServer(server);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

async function notifyBetChanged(betId: string) {
  io.to("side-bets").emit("side-bet:changed", { betId });
}

async function notifyChatMessage(message: ChatMessage) {
  if (message.room === "side_bet" && message.sideBetId) {
    io.to(`chat:side-bet:${message.sideBetId}`).emit("chat:message", message);
    return;
  }

  io.to("chat:general").emit("chat:message", message);
}

app.use("/api", createApiRouter({ notifyBetChanged, notifyChatMessage }));

if (config.nodeEnv === "production") {
  const clientDist = path.resolve(process.cwd(), "client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
    root: path.resolve(process.cwd(), "client")
  });
  app.use(vite.middlewares);
}

server.listen(config.port, () => {
  console.log(`Side Bets listening on http://localhost:${config.port}`);
});
