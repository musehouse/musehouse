// Verifies USDC tips by reading public chain data (JSON-RPC). The house never holds keys or funds.
import type { WalletChain } from "@musehouse/shared";

interface ChainConfig {
  chainId: number;
  rpc: string;
  usdc: string;
  decimals: number;
}

export const CHAINS: Record<WalletChain, ChainConfig> = {
  BASE: {
    chainId: 8453,
    rpc: process.env.RPC_URL_BASE ?? "https://mainnet.base.org",
    usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    decimals: 6,
  },
  "BASE-SEPOLIA": {
    chainId: 84532,
    rpc: process.env.RPC_URL_BASE_SEPOLIA ?? "https://sepolia.base.org",
    usdc: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    decimals: 6,
  },
  "ARC-TESTNET": {
    chainId: 5042002,
    rpc: process.env.RPC_URL_ARC_TESTNET ?? "https://rpc.testnet.arc.network",
    usdc: "0x3600000000000000000000000000000000000000",
    decimals: 6,
  },
};

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface TipCheck {
  chain: WalletChain;
  txHash: string;
  from: string;
  to: string;
}

export type TipResult = { ok: true; amount: number } | { ok: false; reason: string };

interface Receipt {
  status: string;
  logs: { address: string; topics: string[]; data: string }[];
}

export interface VerifyOptions {
  fetch?: typeof fetch;
  /** How long to keep waiting for a pending transaction. */
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const topicFor = (address: string) => "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");

async function getReceipt(rpc: string, txHash: string, doFetch: typeof fetch): Promise<Receipt | null> {
  const res = await doFetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: Receipt | null; error?: { message?: string } };
  if (body.error) throw new Error(`RPC error: ${body.error.message ?? "unknown"}`);
  return body.result ?? null;
}

/** Confirms that `txHash` moved USDC from `from` to `to` on `chain`. Returns the amount in USDC. */
export async function verifyUsdcTransfer(check: TipCheck, opts: VerifyOptions = {}): Promise<TipResult> {
  const cfg = CHAINS[check.chain];
  if (!cfg) return { ok: false, reason: `Unsupported chain ${check.chain}.` };
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.waitMs ?? 90_000);
  let pollMs = opts.pollMs ?? 3000;

  let receipt: Receipt | null = null;
  let lastError = "";
  for (;;) {
    try {
      receipt = await getReceipt(cfg.rpc, check.txHash, doFetch);
      if (receipt) break;
    } catch (err) {
      lastError = (err as Error).message;
    }
    if (Date.now() + pollMs > deadline) break;
    await sleep(pollMs);
    pollMs = Math.min(pollMs * 1.5, 10_000);
  }
  if (!receipt) {
    return { ok: false, reason: lastError ? `Couldn't read the chain (${lastError}).` : `Transaction not found on ${check.chain} yet.` };
  }
  if (receipt.status !== "0x1") return { ok: false, reason: "That transaction failed on-chain." };

  const fromTopic = topicFor(check.from);
  const toTopic = topicFor(check.to);
  let raw = 0n;
  for (const log of receipt.logs ?? []) {
    if (log.address?.toLowerCase() !== cfg.usdc) continue;
    if (log.topics?.[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (log.topics[1]?.toLowerCase() !== fromTopic || log.topics[2]?.toLowerCase() !== toTopic) continue;
    raw += BigInt(log.data);
  }
  if (raw === 0n) {
    return { ok: false, reason: `No USDC transfer from your wallet to theirs in that transaction (${check.chain}).` };
  }
  return { ok: true, amount: Number(raw) / 10 ** cfg.decimals };
}
