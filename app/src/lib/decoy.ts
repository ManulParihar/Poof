// Decoy / timing defenses — automated self-transfers that fatten the anonymity
// set and sever timing correlations.
//
// A self-transfer spends your notes and re-emits fresh commitments to yourself:
// the chain sees new joinsplits with new nullifiers and new output commitments,
// indistinguishable from real payments, while your balance is unchanged. Doing a
// few of these on a RANDOMIZED schedule:
//   • adds commitments to the pool (everyone's anonymity set grows), and
//   • moves your notes to fresh leaves with deposits between them and their
//     origin, breaking the "deposited then immediately spent" timing tell.
//
// This module is pure orchestration over the wallet's existing `send` — no new
// crypto, no circuit changes.

export interface SelfAddress {
  pubkey: string;
  encPub: string;
}

export type DecoyPhase = "waiting" | "sending" | "done" | "error";

export interface DecoyRoundInfo {
  round: number;
  total: number;
  amount: bigint;
  phase: DecoyPhase;
  error?: string;
}

export interface DecoyOptions {
  rounds: number;
  currencyId: number;
  minDelaySec: number;
  maxDelaySec: number;
  /** the wallet's send(); a self-transfer when given our own address. */
  send: (currencyId: number, pubkey: string, encPub: string, amount: bigint) => Promise<unknown>;
  /** our own shielded address (the decoy destination). */
  address: SelfAddress;
  /** read the *current* spendable balance fresh each round (it changes as notes settle). */
  balanceOf: () => bigint;
  onRound?: (info: DecoyRoundInfo) => void;
  signal?: AbortSignal;
}

/** Uniform random delay in ms within [minSec, maxSec]. */
export function jitterMs(minSec: number, maxSec: number): number {
  const lo = Math.min(minSec, maxSec);
  const hi = Math.max(minSec, maxSec);
  return Math.round((lo + Math.random() * (hi - lo)) * 1000);
}

/** A random, non-round-looking portion of the balance to self-send (10–89%). */
export function pickDecoyAmount(balance: bigint): bigint {
  if (balance <= 0n) return 0n;
  const pct = 10 + Math.floor(Math.random() * 80); // 10..89
  const amt = (balance * BigInt(pct)) / 100n;
  return amt > 0n ? amt : balance;
}

/** setTimeout that resolves early (and cleanly) if the signal aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(t); resolve(); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run `rounds` decoy self-transfers with randomized gaps. Returns how many
 * completed. Stops early on abort or the first send failure (so we never spin on
 * a broken chain). Each round reads the balance fresh, so a stale snapshot can't
 * over-spend.
 */
export async function runDecoyRounds(opts: DecoyOptions): Promise<number> {
  let completed = 0;
  for (let round = 1; round <= opts.rounds; round++) {
    if (opts.signal?.aborted) break;

    const delay = jitterMs(opts.minDelaySec, opts.maxDelaySec);
    opts.onRound?.({ round, total: opts.rounds, amount: 0n, phase: "waiting" });
    await abortableSleep(delay, opts.signal);
    if (opts.signal?.aborted) break;

    const balance = opts.balanceOf();
    const amount = pickDecoyAmount(balance);
    if (amount <= 0n) {
      opts.onRound?.({ round, total: opts.rounds, amount: 0n, phase: "error", error: "no spendable balance" });
      break;
    }

    opts.onRound?.({ round, total: opts.rounds, amount, phase: "sending" });
    try {
      await opts.send(opts.currencyId, opts.address.pubkey, opts.address.encPub, amount);
      completed++;
      opts.onRound?.({ round, total: opts.rounds, amount, phase: "done" });
    } catch (e: any) {
      opts.onRound?.({ round, total: opts.rounds, amount, phase: "error", error: String(e?.message ?? e) });
      break;
    }
  }
  return completed;
}
