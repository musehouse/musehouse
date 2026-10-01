import { describe, expect, it } from "vitest";
import { CHAINS, verifyUsdcTransfer } from "../src/chain/usdc.js";

const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const HASH = "0x" + "ab".repeat(32);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topic = (a: string) => "0x" + a.slice(2).padStart(64, "0");
const amount = (usdc: number) => "0x" + BigInt(Math.round(usdc * 1e6)).toString(16).padStart(64, "0");

function transferLog(from: string, to: string, usdc: number, token = CHAINS["BASE-SEPOLIA"].usdc) {
  return { address: token, topics: [TRANSFER, topic(from), topic(to)], data: amount(usdc) };
}

/** A fake JSON-RPC endpoint returning the given receipts in order. */
function rpc(...results: unknown[]): typeof fetch {
  let i = 0;
  return (async () => {
    const result = results[Math.min(i++, results.length - 1)];
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  }) as typeof fetch;
}

const check = { chain: "BASE-SEPOLIA" as const, txHash: HASH, from: FROM, to: TO };
const fast = { sleep: async () => {}, pollMs: 1, waitMs: 50 };

describe("verifyUsdcTransfer", () => {
  it("confirms a USDC transfer and returns the amount", async () => {
    const res = await verifyUsdcTransfer(check, { ...fast, fetch: rpc({ status: "0x1", logs: [transferLog(FROM, TO, 0.1)] }) });
    expect(res).toEqual({ ok: true, amount: 0.1 });
  });

  it("matches addresses case-insensitively (checksummed input)", async () => {
    const res = await verifyUsdcTransfer(
      { ...check, from: "0xAbCdEf0000000000000000000000000000000001" },
      { ...fast, fetch: rpc({ status: "0x1", logs: [transferLog("0xabcdef0000000000000000000000000000000001", TO, 2.5)] }) },
    );
    expect(res).toEqual({ ok: true, amount: 2.5 });
  });

  it("rejects a transfer to someone else", async () => {
    const res = await verifyUsdcTransfer(check, { ...fast, fetch: rpc({ status: "0x1", logs: [transferLog(FROM, OTHER, 1)] }) });
    expect(res.ok).toBe(false);
  });

  it("rejects a transfer of a different token", async () => {
    const fake = transferLog(FROM, TO, 1, "0x9999999999999999999999999999999999999999");
    const res = await verifyUsdcTransfer(check, { ...fast, fetch: rpc({ status: "0x1", logs: [fake] }) });
    expect(res.ok).toBe(false);
  });

  it("rejects a failed transaction", async () => {
    const res = await verifyUsdcTransfer(check, { ...fast, fetch: rpc({ status: "0x0", logs: [transferLog(FROM, TO, 1)] }) });
    expect(res).toMatchObject({ ok: false, reason: expect.stringMatching(/failed/) });
  });

  it("waits for a pending transaction to be mined", async () => {
    const res = await verifyUsdcTransfer(check, {
      ...fast,
      waitMs: 1000,
      fetch: rpc(null, null, { status: "0x1", logs: [transferLog(FROM, TO, 0.25)] }),
    });
    expect(res).toEqual({ ok: true, amount: 0.25 });
  });

  it("gives up on a transaction that never shows up", async () => {
    const res = await verifyUsdcTransfer(check, { ...fast, fetch: rpc(null) });
    expect(res).toMatchObject({ ok: false, reason: expect.stringMatching(/not found/) });
  });

  it("reports RPC failures", async () => {
    const res = await verifyUsdcTransfer(check, { ...fast, fetch: rpc(new Error("boom")) });
    expect(res).toMatchObject({ ok: false, reason: expect.stringMatching(/boom/) });
  });
});
