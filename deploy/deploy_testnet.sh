#!/usr/bin/env bash
# Deploy Veil to Stellar testnet. Permissionless: friendbot funds the deployer,
# so no pre-existing credentials are needed.
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITY="${VEIL_IDENTITY:-veil-deployer}"
NETWORK="${VEIL_NETWORK:-testnet}"

echo "==> ensure funded identity '$IDENTITY'"
stellar keys generate "$IDENTITY" --network "$NETWORK" --fund 2>/dev/null || \
  stellar keys fund "$IDENTITY" --network "$NETWORK" || true
ADDR=$(stellar keys address "$IDENTITY")
echo "    deployer: $ADDR"

echo "==> build optimized contract wasm (wasm32v1-none, real verifier)"
cargo build -p veil-contract --target wasm32v1-none --release
WASM=target/wasm32v1-none/release/veil_contract.wasm
stellar contract optimize --wasm "$WASM" 2>/dev/null || true
OPT=target/wasm32v1-none/release/veil_contract.optimized.wasm
[ -f "$OPT" ] && WASM="$OPT"

echo "==> deploy"
CID=$(stellar contract deploy --wasm "$WASM" --source "$IDENTITY" --network "$NETWORK")
echo "    contract: $CID"

echo "==> init (levels=20, root_history_size=64)"
stellar contract invoke --id "$CID" --source "$IDENTITY" --network "$NETWORK" \
  -- init --admin "$ADDR" --config '{"levels":20,"root_history_size":64}'

echo "==> sanity reads"
stellar contract invoke --id "$CID" --source "$IDENTITY" --network "$NETWORK" -- get_config
stellar contract invoke --id "$CID" --source "$IDENTITY" --network "$NETWORK" -- current_root

echo "==> done. contract: $CID"
