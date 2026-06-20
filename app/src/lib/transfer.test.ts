// Reproduce the send/transfer flow end to end against the real circuit, to find
// the ForceEqualIfEnabled (Merkle membership) failure. Mirrors store.send:
// deposit a note → rebuild tree from leaves → indexOf → buildTransfer → prove.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as snarkjs from "snarkjs";
import { initCrypto, deriveKeys, fieldToBytes, commitment, type Note } from "./crypto";
import { ClientMerkleTree } from "./merkleTree";
import { buildDeposit, buildTransfer } from "./witness";
import { DEFAULT_CURRENCY_ID } from "./currencies";

const here = dirname(fileURLToPath(import.meta.url));
const CIRCUIT = join(here, "../../public/circuit");
const WASM = join(CIRCUIT, "transaction.wasm");
const ZKEY = join(CIRCUIT, "transaction.zkey");

beforeAll(async () => { await initCrypto(); });

describe("transfer spends a self-deposited note", () => {
  it("builds a membership-valid witness and proves", async () => {
    const keys = deriveKeys(fieldToBytes(424242n));
    const cid = DEFAULT_CURRENCY_ID;

    // 1) deposit 1000 → the value note is output[0]; mirror the contract's two-leaf insert.
    const tree = new ClientMerkleTree();
    const dep = buildDeposit({
      root: tree.root(), sk: keys.spendKey, selfPub: keys.publicKey,
      selfEncPub: keys.encPublic, amount: 1000n, currencyId: cid,
      settlementAddress: "GAKON75EXHETR5EAUTZLO5S7YSYMUXV4VRAPYWHHD4AG2QVSBAM3CJLM",
    });
    // the two output commitments enter the tree at indices 0,1
    const cm0 = commitment(dep.outputs[0].note);
    const cm1 = commitment(dep.outputs[1].note);
    tree.insertMany([cm0, cm1]);

    const depositNote: Note = dep.outputs[0].note; // amount 1000, our pubkey
    expect(depositNote.amount).toBe(1000n);
    expect(depositNote.pubkey).toBe(keys.publicKey); // must equal Poseidon(sk)

    // 2) send 400 to a recipient — mirror store.send: indexOf in the synced tree
    const idx = tree.indexOf(commitment(depositNote));
    expect(idx).toBe(0);

    const recipient = deriveKeys(fieldToBytes(7777n));
    const xfer = buildTransfer({
      tree, sk: keys.spendKey, selfPub: keys.publicKey, selfEncPub: keys.encPublic,
      inputNote: depositNote, inputLeafIndex: idx,
      amount: 400n, recipientPub: recipient.publicKey, recipientEncPub: recipient.encPublic,
      settlementAddress: "GAKON75EXHETR5EAUTZLO5S7YSYMUXV4VRAPYWHHD4AG2QVSBAM3CJLM",
    });

    // 3) prove — this is where ForceEqualIfEnabled (membership) would assert.
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(xfer.input, WASM, ZKEY);
    const vkey = JSON.parse(readFileSync(join(CIRCUIT, "verification_key.json"), "utf8"));
    expect(await snarkjs.groth16.verify(vkey, publicSignals, proof)).toBe(true);
  }, 60000);

  // Reproduce a busy on-chain tree: the note sits at a high, odd-ish index among
  // many unrelated commitments. This is the real-world shape the user hits.
  it("spends a note buried among many leaves (high index)", async () => {
    const keys = deriveKeys(fieldToBytes(424242n));
    const cid = DEFAULT_CURRENCY_ID;
    const tree = new ClientMerkleTree();

    // pad with 21 unrelated leaves, then our note, then more padding
    for (let i = 0; i < 21; i++) tree.insert(BigInt(1000 + i));
    const note: Note = { amount: 1000n, currencyId: cid, pubkey: keys.publicKey, blinding: 99n };
    const myIdx = tree.insert(commitment(note));
    for (let i = 0; i < 14; i++) tree.insert(BigInt(5000 + i));
    expect(myIdx).toBe(21);

    // local self-consistency: path must reconstruct root for this leaf
    const idx = tree.indexOf(commitment(note));
    expect(idx).toBe(myIdx);

    const recipient = deriveKeys(fieldToBytes(7777n));
    const xfer = buildTransfer({
      tree, sk: keys.spendKey, selfPub: keys.publicKey, selfEncPub: keys.encPublic,
      inputNote: note, inputLeafIndex: idx,
      amount: 400n, recipientPub: recipient.publicKey, recipientEncPub: recipient.encPublic,
      settlementAddress: "GAKON75EXHETR5EAUTZLO5S7YSYMUXV4VRAPYWHHD4AG2QVSBAM3CJLM",
    });
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(xfer.input, WASM, ZKEY);
    const vkey = JSON.parse(readFileSync(join(CIRCUIT, "verification_key.json"), "utf8"));
    expect(await snarkjs.groth16.verify(vkey, publicSignals, proof)).toBe(true);
  }, 60000);
});
