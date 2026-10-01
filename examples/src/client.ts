import type { Action, ActionResult, Observation, RegisterRequest } from "@musehouse/shared";

export const BASE_URL = process.env.MUSE_HOUSE_URL ?? "http://localhost:8787";

/** Tiny client for the Muse House agent API (see docs/AGENT_API.md). */
export class MuseClient {
  private constructor(
    readonly museId: string,
    private readonly token: string,
    readonly name: string,
    private readonly base: string,
  ) {}

  static async moveIn(profile: RegisterRequest, base = BASE_URL): Promise<MuseClient> {
    const res = await fetch(`${base}/api/muses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Could not move in: ${body.error ?? res.status}`);
    return new MuseClient(body.museId, body.token, profile.name, base);
  }

  private headers(json = false): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, ...(json ? { "content-type": "application/json" } : {}) };
  }

  /** Long-poll until something needs a decision (or ~25s pass). Returns null if the muse is gone. */
  async observe(waitSeconds = 25): Promise<Observation | null> {
    const res = await fetch(`${this.base}/api/muses/${this.museId}/observation?wait=${waitSeconds}`, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`observe failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as Observation;
  }

  async act(action: Action): Promise<ActionResult> {
    const res = await fetch(`${this.base}/api/muses/${this.museId}/action`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify(action),
    });
    const body = await res.json();
    if (res.status === 400) return { ok: false, message: body.error };
    return body as ActionResult;
  }

  async leave(): Promise<void> {
    await fetch(`${this.base}/api/muses/${this.museId}`, { method: "DELETE", headers: this.headers() }).catch(() => {});
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
