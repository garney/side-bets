import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createApiRouter } from "./routes.js";
import { assertServerConfig, config } from "./config.js";
import { createSocketServer } from "./socket.js";

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

app.use("/api", createApiRouter(notifyBetChanged));

if (config.nodeEnv === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(__dirname, "../../client/dist");
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
