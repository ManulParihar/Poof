import { describe, it, expect, beforeAll } from "vitest";
import { initCrypto, deriveKeys, encryptNote, encWire, commitment, fieldToBytes, toHex, type Note } from "./crypto";
import type { CommitmentEvent } from "./chain";
import {
  exportViewingKey, serializeViewingKey, parseViewingKey, auditWithViewingKey,
  makeReceipt, serializeReceipt, parseReceipt, verifyReceipt, verifyReceiptOnChain,
} from "./disclosure";

const CONTRACT = "CDVNLQYWDDH4BJQJBIOWW2CJELVR62FGGVPQN3ZMUNS7PUCIWH3SBLPN";

beforeAll(async () => { await initCrypto(); });

function eventForNote(note: Note, recipientEncPub: Uint8Array, leafIndex: number): CommitmentEvent {
  const enc = encryptNote(recipientEncPub, note);
  return {
    commitment: fieldToBytes(commitment(note)),
    leafIndex,
    ciphertext: encWire(enc),
    viewTag: enc.viewTag,
    ledger: 0,
  };
}

describe("viewing key", () => {
  it("serializes and parses", () => {
    const keys = deriveKeys(new Uint8Array(32).fill(7));
    const vk = exportViewingKey(keys, CONTRACT);
    const token = serializeViewingKey(vk);
    expect(token.startsWith("veilvk1:")).toBe(true);
    expect(parseViewingKey(token)).toEqual(vk);
  });

  it("rejects garbage", () => {
    expect(parseViewingKey("nonsense")).toBeNull();
  });

  it("recovers notes addressed to it but not to others", () => {
    const me = deriveKeys(new Uint8Array(32).fill(1));
    const other = deriveKeys(new Uint8Array(32).fill(2));
    const mine: Note = { amount: 5_0000000n, currencyId: 0, pubkey: me.publicKey, blinding: 99n };
    const theirs: Note = { amount: 3_0000000n, currencyId: 1, pubkey: other.publicKey, blinding: 77n };
    const events = [
      eventForNote(mine, me.encPublic, 0),
      eventForNote(theirs, other.encPublic, 1),
    ];
    const found = auditWithViewingKey(exportViewingKey(me, CONTRACT), events);
    expect(found).toHaveLength(1);
    expect(found[0].note.amount).toBe(5_0000000n);
    expect(found[0].leafIndex).toBe(0);
  });
});

describe("proof-of-payment receipt", () => {
  it("round-trips and self-verifies", () => {
    const keys = deriveKeys(new Uint8Array(32).fill(3));
    const note: Note = { amount: 12345n, currencyId: 1, pubkey: keys.publicKey, blinding: 4242n };
    const r = makeReceipt(note, 7, CONTRACT, { kind: "sent", txHash: "deadbeef" });
    const token = serializeReceipt(r);
    expect(token.startsWith("veilrcpt1:")).toBe(true);
    const back = parseReceipt(token)!;
    expect(back.amount).toBe("12345");
    expect(verifyReceipt(back).selfConsistent).toBe(true);
  });

  it("detects a tampered amount", () => {
    const keys = deriveKeys(new Uint8Array(32).fill(4));
    const note: Note = { amount: 1000n, currencyId: 0, pubkey: keys.publicKey, blinding: 5n };
    const r = makeReceipt(note, 0, CONTRACT);
    const tampered = { ...r, amount: "999999" };
    expect(verifyReceipt(tampered).selfConsistent).toBe(false);
  });

  it("confirms presence on-chain", () => {
    const keys = deriveKeys(new Uint8Array(32).fill(5));
    const note: Note = { amount: 2_0000000n, currencyId: 0, pubkey: keys.publicKey, blinding: 314n };
    const r = makeReceipt(note, 3, CONTRACT);
    const events: CommitmentEvent[] = [
      { commitment: fieldToBytes(commitment(note)), leafIndex: 3, ciphertext: new Uint8Array(), viewTag: 0, ledger: 0 },
    ];
    const v = verifyReceiptOnChain(r, events);
    expect(v.selfConsistent).toBe(true);
    expect(v.onChain?.present).toBe(true);
    expect(v.onChain?.leafIndexMatches).toBe(true);
    expect(toHex(fieldToBytes(commitment(note)))).toBe(r.commitment);
  });
});
