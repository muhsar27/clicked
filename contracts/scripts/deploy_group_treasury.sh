#!/usr/bin/env bash
# Deploy group_treasury contract to Stellar testnet.
#
# Prerequisites:
#   - stellar CLI installed  (https://developers.stellar.org/docs/tools/stellar-cli)
#   - DEPLOYER_SECRET    Stellar secret key of the deployer account
#   - ADMIN_ADDRESS      Stellar public key of the treasury admin
#   - TOKEN_CONTRACT_ID  Contract ID of the SEP-41 token to use
#   - INITIAL_MEMBERS    Comma-separated list of member Stellar public keys
#
# Usage:
#   DEPLOYER_SECRET=S... \
#   ADMIN_ADDRESS=G... \
#   TOKEN_CONTRACT_ID=C... \
#   INITIAL_MEMBERS=G...,G...,G... \
#   ./scripts/deploy_group_treasury.sh

set -euo pipefail

NETWORK="testnet"
WASM_PATH="target/wasm32-unknown-unknown/release/group_treasury.wasm"

# ── Env validation ────────────────────────────────────────────────────────────

if [[ -z "${DEPLOYER_SECRET:-}" ]]; then
  echo "Error: DEPLOYER_SECRET is not set" >&2
  exit 1
fi

if [[ -z "${ADMIN_ADDRESS:-}" ]]; then
  echo "Error: ADMIN_ADDRESS is not set" >&2
  exit 1
fi

if [[ -z "${TOKEN_CONTRACT_ID:-}" ]]; then
  echo "Error: TOKEN_CONTRACT_ID is not set" >&2
  exit 1
fi

if [[ -z "${INITIAL_MEMBERS:-}" ]]; then
  echo "Error: INITIAL_MEMBERS is not set (comma-separated Stellar public keys)" >&2
  exit 1
fi

# Validate INITIAL_MEMBERS: each entry must be a non-empty string
IFS=',' read -ra MEMBER_ARRAY <<< "$INITIAL_MEMBERS"
if [[ ${#MEMBER_ARRAY[@]} -eq 0 ]]; then
  echo "Error: INITIAL_MEMBERS must contain at least one member address" >&2
  exit 1
fi

for member in "${MEMBER_ARRAY[@]}"; do
  member_trimmed="${member// /}"
  if [[ -z "$member_trimmed" ]]; then
    echo "Error: INITIAL_MEMBERS contains an empty entry" >&2
    exit 1
  fi
done

# ── Build ─────────────────────────────────────────────────────────────────────

echo "==> Building group_treasury contract..."
cargo build -p group_treasury --target wasm32-unknown-unknown --release

# ── Upload WASM ───────────────────────────────────────────────────────────────

echo "==> Uploading WASM to testnet..."
WASM_HASH=$(stellar contract upload \
  --network "$NETWORK" \
  --source "$DEPLOYER_SECRET" \
  --wasm "$WASM_PATH")

echo "    WASM hash: $WASM_HASH"

# ── Deploy contract instance ──────────────────────────────────────────────────

echo "==> Deploying contract instance..."
CONTRACT_ID=$(stellar contract deploy \
  --network "$NETWORK" \
  --source "$DEPLOYER_SECRET" \
  --wasm-hash "$WASM_HASH")

echo "    Contract ID: $CONTRACT_ID"

# ── Build members argument ────────────────────────────────────────────────────

# stellar CLI accepts Vec<Address> as space-separated --members flags
MEMBERS_ARGS=()
for member in "${MEMBER_ARRAY[@]}"; do
  MEMBERS_ARGS+=(--members "${member// /}")
done

# ── Initialize contract ───────────────────────────────────────────────────────

echo "==> Initialising contract..."
stellar contract invoke \
  --network "$NETWORK" \
  --source "$DEPLOYER_SECRET" \
  --id "$CONTRACT_ID" \
  -- initialize \
  --admin "$ADMIN_ADDRESS" \
  --token_contract "$TOKEN_CONTRACT_ID" \
  "${MEMBERS_ARGS[@]}"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "✓ group_treasury deployed and initialised"
echo "  Contract ID    : $CONTRACT_ID"
echo "  Token          : $TOKEN_CONTRACT_ID"
echo "  Admin          : $ADMIN_ADDRESS"
echo "  Members (${#MEMBER_ARRAY[@]})   : $INITIAL_MEMBERS"
echo ""
echo "Add to your .env:"
echo "  GROUP_TREASURY_CONTRACT_ID=$CONTRACT_ID"
