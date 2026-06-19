# Veil — a UTXO-style private payment protocol on Stellar/Soroban

Veil is a **shielded pool**. Real value is custodied in a single Soroban
contract; private "notes" exist on-chain only as Poseidon commitments in an
incremental Merkle tree. Spending a note publishes a **nullifier** (unlinkable to
its commitment) and a **Groth16 proof** that says *"I own a note in this tree, I
derived this nullifier correctly, and my inputs and outputs conserve value"* —
without revealing which note, its value, or its owner. The contract verifies the
proof, rejects seen nullifiers, inserts the new output commitments, and emits
encrypted note ciphertexts so recipients can discover incoming notes.

This README is the honest one: what's real, what's mocked, and the known leaks.

> ⚠️ **Research-grade. Not audited. Single-contributor trusted setup. Do not put
> real funds on this.**

## Live on testnet

| | |
|---|---|
| Contract ID | [`CD6WNAXYDSDNTKE5MX6FENGR6VO6GZY55Q2MNMA664D2NXKCF6HMR5X4`](https://stellar.expert/explorer/testnet/contract/CD6WNAXYDSDNTKE5MX6FENGR6VO6GZY55Q2MNMA664D2NXKCF6HMR5X4) |
| Network | Stellar testnet |
| Deployed wasm | 63,754 bytes (optimized) |
| Genesis root | `2d3c07bea6883428edd2d80d07cec4b911309fed96743822d6aadea06313a951` |

Deployed, initialized (`levels=20, root_history_size=64`), and read methods
(`get_config`, `current_root`, `next_leaf_index`) confirmed live. See
[`deploy/addresses.json`](deploy/addresses.json).

## The four planes

| Plane | Crate / dir | Role |
|---|---|---|
| 1. Crypto core | [`crates/veil-crypto`](crates/veil-crypto) | The single source of Poseidon truth (BN254, circomlib-compatible), `no_std`. Note/commitment/nullifier math. |
| 2. Circuit | [`circuits/`](circuits) | The 2-in/2-out Circom joinsplit, trusted setup, proving. |
| 3. Contract | [`crates/veil-contract`](crates/veil-contract) | The Soroban authority: Merkle tree, nullifier set, **native BN254 Groth16 verify**, events. |
| 4. Client + indexer | [`crates/veil-sdk`](crates/veil-sdk), [`indexer/`](indexer) | Key derivation, note encryption, trial-decrypt, proving, witness assembly; permanent event store. |

The make-or-break invariant: **Poseidon is bit-identical across all three Rust
consumers and the circuit.** Asserted in
[`crates/veil-crypto/tests/cross_impl.rs`](crates/veil-crypto/tests/cross_impl.rs)
against the canonical vector `Poseidon([1,2]) =
7853200120776062878684798364095072458815029376092732009249414926327459813530`
and reproduced *in-circuit* in
[`circuits/test/transaction.test.js`](circuits/test/transaction.test.js).

## What's real and load-bearing

- **On-chain Groth16 verification** via Soroban's native BN254 host functions
  (`Bn254::pairing_check`). A real circuit proof verifies through the real host
  pairing; tampering any public signal yields `ProofInvalid`. Measured cost:
  **27.96M CPU instructions** — well under Soroban's 100M budget.
- **Range checks + value conservation in-circuit** (`publicAmount + Σin = Σout`,
  every amount ∈ [0, 2⁶⁴)). No money from nothing, no field-wrap minting.
- **Double-spend prevention**: one persistent entry per nullifier, max TTL
  (archival-safe), validated before any state mutation.
- **Incremental Merkle tree** (depth 20) with a 64-root rolling history window
  for stale-root concurrency. The contract's root provably matches the SDK's
  off-chain reconstruction.
- **2-in/2-out private transfer** with real Poseidon commitments and a wallet
  that builds value-conserving witnesses (1 real + 1 dummy input) and proves
  them with snarkjs (`snarkJS: OK!`).

The test that proves the ZK is load-bearing: remove/forge the proof and anyone
could spend anyone's notes — and the verifier rejects it. See
[`crates/veil-contract/src/verifier.rs`](crates/veil-contract/src/verifier.rs)
`real_proof_test`.

## What's mocked / simplified in the MVP

- **Trusted setup**: a single-contributor local powers-of-tau + zkey (no
  ceremony). Flagged loudly in [`circuits/scripts/setup.sh`](circuits/scripts/setup.sh).
  **Not production-safe.**
- **Poseidon variant**: original circomlib Poseidon (not Poseidon2). Chosen for
  the MVP because it's the lowest-risk way to guarantee the cross-impl gate
  passes (battle-tested circom template + audited `light-poseidon` reference).
  Poseidon2 is a drop-in optimisation later. *(CLAUDE.md preferred Poseidon2;
  this is the one deliberate deviation, justified by the gate's primacy.)*
- **Note delivery**: ciphertext events are emitted from day one (wire format
  fixed), but the SDK's automatic indexer-driven scan is wired for Phase 2; MVP
  supports out-of-band delivery too.
- **Viewing-key delegation**: `nk`/`ivk`/`ovk` are derived in the key hierarchy
  but not yet exercised.
- **Deposit/withdraw (Phase 2)**: the value-conservation equation carries a
  signed `publicAmount` from day one; a non-zero amount is rejected
  (`InsufficientFunds`) until token settlement is wired.

## Known leaks (documented, not hidden)

- **Fee-payer deanonymization** — whoever submits the tx is visible on-chain and
  links to the action. Real fix is relayers (the proof binds recipient/relayer/
  fee via `extDataHash`, so the plumbing is ready). 
- **Small anonymity set** — a demo pool with few notes offers little privacy.
- **No audit, no ceremony** — research-grade.

## Build & test

```bash
# 1. The crypto gate (must pass first)
cargo test -p veil-crypto

# 2. Circuit: setup + tests + a real proof
cd circuits
node $NVM/lib/node_modules/npm/bin/npm-cli.js install
bash scripts/setup.sh
node test/transaction.test.js
node scripts/gen_sample_input.js && bash scripts/prove.sh build/sample_input.json
cd ..

# 3. Contract: native edge cases + the REAL proof path + budget
cargo test -p veil-contract --features mock-verifier   # 15 edge-case tests
cargo test -p veil-contract                            # real-proof + budget tests
cargo build -p veil-contract --target wasm32v1-none --release

# 4. SDK + indexer
cargo test -p veil-sdk
cargo test -p veil-sdk --test e2e_prove -- --ignored    # wallet → snarkjs → verify
cargo test -p veil-indexer

# 5. Wire the real VK into the contract (snarkjs → vk.rs, with the G2 c1‖c0 swap)
node circuits/scripts/export_vk_rust.js

# 6. Deploy to testnet (permissionless friendbot funding)
bash deploy/deploy_testnet.sh
```

## Architecture

See [`CLAUDE.md`](CLAUDE.md) for the full design, [`INTERFACES.md`](INTERFACES.md)
for the frozen cross-plane contracts (public-signal order, `extDataHash`, event
schema, VK byte layout), and [`PROGRESS.md`](PROGRESS.md) for the build log.

## License

Apache-2.0.
