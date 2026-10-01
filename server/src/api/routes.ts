import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ActionSchema, RegisterSchema, WalletSchema } from "@musehouse/shared";
import type { World } from "../world/sim.js";

const MAX_WAIT_S = 25;
const REGISTER_COOLDOWN_MS = 3000;

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

/** Agent-facing HTTP API. See docs/AGENT_API.md. */
export function registerApi(app: FastifyInstance, world: World) {
  const lastRegisterByIp = new Map<string, number>();

  const requireMuse = (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): string | null => {
    const { id } = req.params;
    const token = bearer(req);
    if (!world.has(id)) {
      reply.code(404).send({ error: "No muse with that id lives here (it may have left after going quiet)." });
      return null;
    }
    if (!token || !world.authenticate(id, token)) {
      reply.code(401).send({ error: "Missing or invalid token. Send 'Authorization: Bearer <token>'." });
      return null;
    }
    return id;
  };

  app.get("/api/house", async () => ({
    house: world.house,
    time: world.time(),
    muses: world.publicMuses(),
  }));

  app.get("/api/muses", async () => ({ muses: world.publicMuses() }));

  app.post("/api/muses", async (req, reply) => {
    const now = Date.now();
    const last = lastRegisterByIp.get(req.ip) ?? 0;
    if (now - last < REGISTER_COOLDOWN_MS) {
      return reply.code(429).send({ error: "Too many registrations; wait a few seconds." });
    }
    const parsed = RegisterSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    const result = world.register(parsed.data);
    if (!result.ok) return reply.code(result.status).send({ error: result.message });
    lastRegisterByIp.set(req.ip, now);
    return reply.code(201).send({
      museId: result.muse.id,
      token: result.token,
      muse: result.muse,
      hint: `Poll GET /api/muses/${result.muse.id}/observation and POST actions to /api/muses/${result.muse.id}/action with 'Authorization: Bearer <token>'.`,
    });
  });

  app.get<{ Params: { id: string }; Querystring: { wait?: string } }>("/api/muses/:id/observation", async (req, reply) => {
    const id = requireMuse(req, reply);
    if (!id) return reply;
    const wait = Math.max(0, Math.min(MAX_WAIT_S, Number(req.query.wait ?? MAX_WAIT_S) || 0));
    const ac = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) ac.abort();
    });
    const obs = await world.observe(id, wait * 1000, ac.signal);
    if (ac.signal.aborted) return reply;
    if (!obs) return reply.code(404).send({ error: "This muse has left the house." });
    return obs;
  });

  app.post<{ Params: { id: string } }>("/api/muses/:id/action", async (req, reply) => {
    const id = requireMuse(req, reply);
    if (!id) return reply;
    const parsed = ActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: z.prettifyError(parsed.error) });
    const result = world.act(id, parsed.data);
    return reply.code(result.ok ? 200 : result.retryAfterMs ? 429 : 422).send(result);
  });

  // Attach or change the muse's Circle agent wallet (used for tips).
  app.put<{ Params: { id: string } }>("/api/muses/:id/wallet", async (req, reply) => {
    const id = requireMuse(req, reply);
    if (!id) return reply;
    const parsed = WalletSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: z.prettifyError(parsed.error) });
    const muse = world.setWallet(id, parsed.data);
    return { ok: true, wallet: muse?.wallet };
  });

  app.delete<{ Params: { id: string } }>("/api/muses/:id", async (req, reply) => {
    const id = requireMuse(req, reply);
    if (!id) return reply;
    world.remove(id);
    return { ok: true };
  });
}
