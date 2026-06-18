#!/usr/bin/env bash
# Generate and verify a Groth16 proof for a given witness input.
#   bash scripts/prove.sh <input.json> [out_dir]
# Produces <out_dir>/proof.json and <out_dir>/public.json and verifies them.
set -euo pipefail

cd "$(dirname "$0")/.."
SNARKJS="node $(pwd)/node_modules/.bin/snarkjs"
INPUT="${1:?usage: prove.sh <input.json> [out_dir]}"
OUT="${2:-build}"
WASM="build/transaction_js/transaction.wasm"
ZKEY="build/transaction.zkey"
VKEY="build/verification_key.json"

mkdir -p "$OUT"
echo "==> groth16 fullprove"
$SNARKJS groth16 fullprove "$INPUT" "$WASM" "$ZKEY" "$OUT/proof.json" "$OUT/public.json"

echo "==> verify"
$SNARKJS groth16 verify "$VKEY" "$OUT/public.json" "$OUT/proof.json"

echo "==> public signals:"
cat "$OUT/public.json"
