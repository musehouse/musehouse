import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import type { ViewerMessage } from "@musehouse/shared";
import { HOUSE } from "./world/house.js";
import { World } from "./world/sim.js";
import { registerApi } from "./api/routes.js";
import { NPCS } from "./npc/roster.js";
import { startNpcs } from "./npc/runner.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const TICK_MS = 200;
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, "../../web/dist");

const world = new World(HOUSE, {
  gameMinutesPerSecond: Number(process.env.GAME_MINUTES_PER_SECOND ?? 1),
  startHour: Number(process.env.START_HOUR ?? 8),
});

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
// The viewer may be hosted elsewhere (e.g. Vercel) and agents can call the API from anywhere.
await app.register(fastifyCors, { origin: true });
await app.register(fastifyWebsocket);
registerApi(app, world);
app.get("/healthz", async () => ({ ok: true, muses: world.publicMuses().length, time: world.time().clock }));

// ---- Viewer websocket: snapshot on connect, then ticks + events. ----
const viewers = new Set<WebSocket>();
const send = (ws: WebSocket, msg: ViewerMessage) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};
const broadcast = (msg: ViewerMessage) => {
  const data = JSON.stringify(msg);
  for (const ws of viewers) if (ws.readyState === ws.OPEN) ws.send(data);
};

app.get("/ws/viewer", { websocket: true }, (socket) => {
  viewers.add(socket);
  send(socket, { type: "snapshot", house: world.house, time: world.time(), muses: world.publicMuses(), feed: world.recentFeed() });
  socket.on("close", () => viewers.delete(socket));
  socket.on("error", () => viewers.delete(socket));
});

world.onEvent((event) => broadcast({ type: "event", event }));

// The house's own residents (set NPCS=off to start with an empty house).
if (process.env.NPCS !== "off") startNpcs(world, NPCS);

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  world.tick(now - last);
  last = now;
  if (viewers.size > 0) broadcast({ type: "tick", time: world.time(), muses: world.publicMuses() });
}, TICK_MS);

// ---- Serve the built viewer in production (`npm run build`). ----
if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}

await app.listen({ port: PORT, host: HOST });
app.log.info(`Muse House is open on http://localhost:${PORT}`);
