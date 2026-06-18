// Veil circuit tests — runnable with plain node (no mocha):
//   node test/transaction.test.js
//
// Proves: (1) the circuit's Poseidon matches the pinned veil-crypto vectors
// (the cross-impl gate, through the circuit); (2) the joinsplit accepts a valid
// value-conserving witness; (3) it rejects value non-conservation; (4) it
// rejects duplicate input nullifiers.

const path = require("path");
const assert = require("assert");
const wasm_tester = require("circom_tester").wasm;

const INCLUDE = [
  path.join(__dirname, "../node_modules/circomlib/circuits"),
  path.join(__dirname, "../src"),
];

// Pinned vectors from INTERFACES.md §0 / veil-crypto cross_impl test.
const PIN = {
  pk: "7061949393491957813657776856458368574501817871421526214197139795307327923534",
  cm: "9393485090685125340160626343171654838660902907959359341345939329381592242612",
  nf: "15859786158883198570120416352149778089550541078065235834061119830959898607558",
};

let passed = 0,
  failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("  ✓ " + name);
    passed++;
  } catch (e) {
    console.log("  ✗ " + name + "\n      " + (e.message || e));
    failed++;
  }
}

const ZEROS20 = Array(20).fill("0");

(async () => {
  console.log("Veil circuit tests\n");

  const noteVec = await wasm_tester(
    path.join(__dirname, "circuits/note_vec.circom"),
    { include: INCLUDE }
  );
  const pos3 = await wasm_tester(
    path.join(__dirname, "circuits/pos3.circom"),
    { include: INCLUDE }
  );
  const tx = await wasm_tester(
    path.join(__dirname, "../src/transaction.circom"),
    { include: INCLUDE }
  );

  // helpers that compute the circuit-consistent public values
  async function noteNullifierAndCommitment(sk, amount, blinding, idx) {
    const w = await noteVec.calculateWitness(
      { sk, amount, blinding, pathIndex: idx },
      true
    );
    // output order in witness: [1]=pk, [2]=cm, [3]=nf
    return { cm: w[2].toString(), nf: w[3].toString() };
  }
  async function commitment(amount, pubkey, blinding) {
    const w = await pos3.calculateWitness({ a: amount, b: pubkey, c: blinding }, true);
    return w[1].toString();
  }

  // ---- 1. cross-impl gate, through the circuit ----
  await test("Poseidon note pipeline matches pinned veil-crypto vectors", async () => {
    const w = await noteVec.calculateWitness(
      { sk: "7", amount: "100", blinding: "42", pathIndex: "3" },
      true
    );
    await noteVec.checkConstraints(w);
    await noteVec.assertOut(w, { pk: PIN.pk, cm: PIN.cm, nf: PIN.nf });
  });

  // ---- 2. accept a valid, value-conserving transfer ----
  // Both inputs are zero-value dummies (Merkle membership gated off), funded by
  // publicAmount = 100, split into outputs 100 + 0.
  await test("accepts a valid value-conserving witness", async () => {
    const in0 = await noteNullifierAndCommitment("11", "0", "111", "0");
    const in1 = await noteNullifierAndCommitment("22", "0", "222", "1");
    const outCm0 = await commitment("100", "7", "5");
    const outCm1 = await commitment("0", "7", "6");

    const inp = {
      root: "0",
      publicAmount: "100",
      extDataHash: "12345",
      inputNullifier: [in0.nf, in1.nf],
      outputCommitment: [outCm0, outCm1],
      inAmount: ["0", "0"],
      inPrivateKey: ["11", "22"],
      inBlinding: ["111", "222"],
      inPathIndices: ["0", "1"],
      inPathElements: [ZEROS20, ZEROS20],
      outAmount: ["100", "0"],
      outPubkey: ["7", "7"],
      outBlinding: ["5", "6"],
    };
    const w = await tx.calculateWitness(inp, true);
    await tx.checkConstraints(w);
  });

  // ---- 3. reject value non-conservation ----
  await test("rejects value non-conservation", async () => {
    const in0 = await noteNullifierAndCommitment("11", "0", "111", "0");
    const in1 = await noteNullifierAndCommitment("22", "0", "222", "1");
    const outCm0 = await commitment("100", "7", "5");
    const outCm1 = await commitment("1", "7", "6");
    const inp = {
      root: "0",
      publicAmount: "100",
      extDataHash: "12345",
      inputNullifier: [in0.nf, in1.nf],
      outputCommitment: [outCm0, outCm1],
      inAmount: ["0", "0"],
      inPrivateKey: ["11", "22"],
      inBlinding: ["111", "222"],
      inPathIndices: ["0", "1"],
      inPathElements: [ZEROS20, ZEROS20],
      outAmount: ["100", "1"], // 100 != 100 + 1
      outPubkey: ["7", "7"],
      outBlinding: ["5", "6"],
    };
    let threw = false;
    try {
      await tx.calculateWitness(inp, true);
    } catch (_) {
      threw = true;
    }
    assert(threw, "expected failure on non-conservation");
  });

  // ---- 4. reject duplicate input nullifiers ----
  await test("rejects duplicate input nullifiers", async () => {
    // identical dummy inputs → identical nullifiers → sameNullifier === 0 fails
    const dup = await noteNullifierAndCommitment("11", "0", "111", "0");
    const inp = {
      root: "0",
      publicAmount: "0",
      extDataHash: "1",
      inputNullifier: [dup.nf, dup.nf],
      outputCommitment: [await commitment("0", "7", "5"), await commitment("0", "7", "6")],
      inAmount: ["0", "0"],
      inPrivateKey: ["11", "11"],
      inBlinding: ["111", "111"],
      inPathIndices: ["0", "0"],
      inPathElements: [ZEROS20, ZEROS20],
      outAmount: ["0", "0"],
      outPubkey: ["7", "7"],
      outBlinding: ["5", "6"],
    };
    let threw = false;
    try {
      await tx.calculateWitness(inp, true);
    } catch (_) {
      threw = true;
    }
    assert(threw, "expected failure on duplicate nullifiers");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
