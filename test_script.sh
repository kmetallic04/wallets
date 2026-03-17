# Base URL
BASE_URL="http://localhost:3000"

# ──────────────────────────────────────────────
# 1. Get an Admin API Key
# ──────────────────────────────────────────────
# First, you need an admin key. This endpoint itself requires an
# existing admin key (bootstrap one via seed or better-auth admin signup).
# If you already have one from seeding:

curl -s "$BASE_URL/api/v1/admin/api-keys" \
  -H "x-api-key: YOUR_BOOTSTRAP_ADMIN_KEY" | jq

# Save the returned key:
# ADMIN_KEY="adm_..."

# ──────────────────────────────────────────────
# 2. Get a User API Key (using Admin key)
# ──────────────────────────────────────────────

curl -s "$BASE_URL/api/v1/api-keys" \
  -H "x-api-key: $ADMIN_KEY" | jq

# Save the returned key:
# USER_KEY="usr_..."

# ──────────────────────────────────────────────
# 3. Create User #1 (Alice)
# ──────────────────────────────────────────────

ALICE_WALLET_ID=$(curl -s -X POST "$BASE_URL/api/v1/users" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $USER_KEY" \
  -d '{
    "name": "Alice Wanjiku",
    "email": "alice@example.com"
  }' | jq -r '.wallet.id')
echo "Alice wallet ID: $ALICE_WALLET_ID"

# ──────────────────────────────────────────────
# 4. Create User #2 (Bob)
# ──────────────────────────────────────────────

BOB_WALLET_ID=$(curl -s -X POST "$BASE_URL/api/v1/users" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $USER_KEY" \
  -d '{
    "name": "Bob Kamau",
    "email": "bob@example.com"
  }' | jq -r '.wallet.id')
echo "Bob wallet ID: $BOB_WALLET_ID"

# ──────────────────────────────────────────────
# 5. Deposit 10,000 KES into Alice's wallet
# ──────────────────────────────────────────────

curl -s -X POST "$BASE_URL/api/v1/wallets/deposit" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $USER_KEY" \
  -H "Idempotency-Key: deposit-alice-001" \
  -d "{
    \"walletId\": \"$ALICE_WALLET_ID\",
    \"amount\": 10000
  }" | jq

# ──────────────────────────────────────────────
# 6. Transfer 2,500 KES from Alice to Bob
#    (1% fee = 25 KES, Bob receives 2,500)
# ──────────────────────────────────────────────

curl -s -X POST "$BASE_URL/api/v1/wallets/transfer" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $USER_KEY" \
  -H "Idempotency-Key: transfer-alice-bob-001" \
  -d "{
    \"senderId\": \"$ALICE_WALLET_ID\",
    \"receiverId\": \"$BOB_WALLET_ID\",
    \"amount\": 2500
  }" | jq

# ──────────────────────────────────────────────
# 7. Withdraw 1,000 KES from Alice's wallet
# ──────────────────────────────────────────────

curl -s -X POST "$BASE_URL/api/v1/wallets/withdraw" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $USER_KEY" \
  -H "Idempotency-Key: withdraw-alice-001" \
  -d "{
    \"walletId\": \"$ALICE_WALLET_ID\",
    \"amount\": 1000
  }" | jq

# ──────────────────────────────────────────────
# 8. Check Alice's balance (should be ~6,475)
#    10,000 - 2,500 - 25 (fee) - 1,000 = 6,475
# ──────────────────────────────────────────────

curl -s "$BASE_URL/api/v1/wallets/$ALICE_WALLET_ID/balance" \
  -H "x-api-key: $USER_KEY" | jq

# ──────────────────────────────────────────────
# 9. Check Bob's balance (should be 2,500)
# ──────────────────────────────────────────────

curl -s "$BASE_URL/api/v1/wallets/$BOB_WALLET_ID/balance" \
  -H "x-api-key: $USER_KEY" | jq

# ──────────────────────────────────────────────
# 10. List Alice's transactions
# ──────────────────────────────────────────────

curl -s "$BASE_URL/api/v1/wallets/$ALICE_WALLET_ID/transactions" \
  -H "x-api-key: $USER_KEY" | jq

# ──────────────────────────────────────────────
# 11. List all transactions (admin only)
# ──────────────────────────────────────────────

curl -s "$BASE_URL/api/v1/transactions?limit=50" \
  -H "x-api-key: $ADMIN_KEY" | jq