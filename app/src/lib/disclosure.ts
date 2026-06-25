// Selective disclosure — privacy that can *opt into* auditability.
//
// Two primitives, both built from data the wallet already holds, neither of
// which leaks anything spendable:
//
//   1. Viewing key  — the x25519 *encryption* secret (NOT the spend key). Whoever
//      holds it can trial-decrypt the pool's ciphertext events and see every note
//      addressed to this identity (amounts, assets, timing). They CANNOT spend:
//      spending needs the Poseidon spend key, which a viewing key never contains.
//      This is the auditor / accountant / regulator view.
//
//   2. Proof-of-payment receipt — the *opening* of a note commitment
//      (amount, currencyId, recipientPubkey, blinding). A verifier recomputes
//      commitment = Poseidon(amount, currencyId, pubkey, blinding) and checks it
//      against the on-chain commitment at the note's leaf. It proves "a note of
//      exactly this value was created (in this tx)" — a cryptographic receipt —
//      without revealing the spend key or any other note.

import {
  commitment, computeViewTag, decryptNote, encFromWire, fieldToBytes, toHex, fromHex,
  type Note, type Keys,
} from "./crypto";
import type { CommitmentEvent } from "./chain";
import type { StoredNote } from "./types";

// ── viewing key ──

export const VIEWING_KEY_PREFIX = "veilvk1:";

export interface ViewingKey {
  v: 1;
  /** x25519 encryption secret, 64-hex. Read-only: decrypts, never spends. */
  encSecret: string;
  /** shielded spend pubkey (decimal) — lets the auditor confirm note ownership. */
  pubkey: string;
  /** x25519 encryption pubkey, 64-hex. */
  encPub: string;
  /** the pool contract this key audits. */
  contractId: string;
}

export function exportViewingKey(keys: Keys, contractId: string): ViewingKey {
  return {
    v: 1,
    encSecret: toHex(keys.encSecret),
    pubkey: keys.publicKey.toString(),
    encPub: toHex(keys.encPublic),
    contractId,
  };
}

/** Serialize a viewing key to a single portable token (`veilvk1:<base64>`). */
export function serializeViewingKey(vk: ViewingKey): string {
  return VIEWING_KEY_PREFIX + btoa(JSON.stringify(vk));
}

export function parseViewingKey(token: string): ViewingKey | null {
  try {
    let raw = token.trim();
    if (raw.startsWith(VIEWING_KEY_PREFIX)) raw = raw.slice(VIEWING_KEY_PREFIX.length);
    const obj = JSON.parse(atob(raw));
    if (obj?.v !== 1 || typeof obj.encSecret !== "string" || !/^[0-9a-fA-F]{64}$/.test(obj.encSecret)) return null;
    if (typeof obj.pubkey !== "string" || !/^[0-9]+$/.test(obj.pubkey)) return null;
    return obj as ViewingKey;
  } catch {
    return null;
  }
}

export interface AuditedNote {
  note: Note;
  leafIndex: number;
  commitmentHex: string;
}

/**
 * Replay the pool's commitment events under a viewing key and recover every note
 * addressed to it. Mirrors the wallet's own scan path, but takes only the
 * read-only encryption secret + pubkey (no spend key), so it is safe to run with
 * a third party's viewing key — e.g. an auditor verifying disclosed history.
 */
export function auditWithViewingKey(vk: ViewingKey, events: CommitmentEvent[]): AuditedNote[] {
  const encSecret = fromHex(vk.encSecret);
  const pubkey = BigInt(vk.pubkey);
  const out: AuditedNote[] = [];
  for (const ev of events) {
    if (ev.ciphertext.length < 32) continue;
    const enc = encFromWire(ev.ciphertext, ev.viewTag);
    if (!enc) continue;
    if (computeViewTag(encSecret, enc.ephemeralPub) !== ev.viewTag) continue;
    const note = decryptNote(encSecret, enc);
    if (!note || note.amount <= 0n) continue;
    if (note.pubkey !== pubkey) continue;
    if (toHex(fieldToBytes(commitment(note))) !== toHex(ev.commitment)) continue;
    out.push({ note, leafIndex: ev.leafIndex, commitmentHex: toHex(ev.commitment) });
  }
  return out;
}

// ── proof-of-payment receipt ──

export const RECEIPT_PREFIX = "veilrcpt1:";

export interface PaymentReceipt {
  v: 1;
  kind: "received" | "sent" | "owned";
  /** base units (stroops for XLM), as a decimal string. */
  amount: string;
  currencyId: number;
  /** the note owner's shielded pubkey (decimal). */
  recipientPubkey: string;
  /** the note blinding (decimal) — needed to recompute the commitment. */
  blinding: string;
  /** commitment = Poseidon(amount, currencyId, recipientPubkey, blinding), hex. */
  commitment: string;
  /** on-chain leaf position, when known. */
  leafIndex: number | null;
  /** the transact tx hash that created the note, when known. */
  txHash?: string;
  contractId: string;
  createdAt: number;
}

/** Build a receipt that opens the commitment of a note. */
export function makeReceipt(
  note: Note,
  leafIndex: number | null,
  contractId: string,
  opts: { kind?: PaymentReceipt["kind"]; txHash?: string } = {}
): PaymentReceipt {
  return {
    v: 1,
    kind: opts.kind ?? "owned",
    amount: note.amount.toString(),
    currencyId: note.currencyId,
    recipientPubkey: note.pubkey.toString(),
    blinding: note.blinding.toString(),
    commitment: toHex(fieldToBytes(commitment(note))),
    leafIndex,
    txHash: opts.txHash,
    contractId,
    createdAt: Date.now(),
  };
}

export function makeReceiptFromStored(n: StoredNote, contractId: string, txHash?: string): PaymentReceipt {
  return makeReceipt(n.note, n.leafIndex, contractId, { kind: "owned", txHash });
}

export function serializeReceipt(r: PaymentReceipt): string {
  return RECEIPT_PREFIX + btoa(JSON.stringify(r));
}

export function parseReceipt(token: string): PaymentReceipt | null {
  try {
    let raw = token.trim();
    if (raw.startsWith(RECEIPT_PREFIX)) raw = raw.slice(RECEIPT_PREFIX.length);
    const obj = JSON.parse(atob(raw));
    if (obj?.v !== 1 || typeof obj.commitment !== "string") return null;
    if (!/^[0-9]+$/.test(obj.amount) || !/^[0-9]+$/.test(obj.recipientPubkey) || !/^[0-9]+$/.test(obj.blinding)) return null;
    return obj as PaymentReceipt;
  } catch {
    return null;
  }
}

export interface ReceiptVerification {
  /** the receipt's stated commitment matches Poseidon over its opened fields. */
  selfConsistent: boolean;
  /** the recomputed commitment (hex), for display. */
  recomputed: string;
  /** present only when checked against on-chain events. */
  onChain?: { present: boolean; leafIndexMatches: boolean };
}

/** Verify the math: recompute the commitment from the opened fields and compare. */
export function verifyReceipt(r: PaymentReceipt): ReceiptVerification {
  const note: Note = {
    amount: BigInt(r.amount),
    currencyId: r.currencyId,
    pubkey: BigInt(r.recipientPubkey),
    blinding: BigInt(r.blinding),
  };
  const recomputed = toHex(fieldToBytes(commitment(note)));
  return { selfConsistent: recomputed === r.commitment.toLowerCase(), recomputed };
}

/** Additionally confirm the commitment was actually inserted on-chain. */
export function verifyReceiptOnChain(r: PaymentReceipt, events: CommitmentEvent[]): ReceiptVerification {
  const base = verifyReceipt(r);
  const target = r.commitment.toLowerCase();
  const hit = events.find((e) => toHex(e.commitment) === target);
  return {
    ...base,
    onChain: {
      present: !!hit,
      leafIndexMatches: !!hit && (r.leafIndex == null || hit.leafIndex === r.leafIndex),
    },
  };
}
