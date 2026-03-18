# Wallets API

Headless wallet API built with Next.js, PostgreSQL, Drizzle ORM, and Better Auth API keys.

This project is meant to show how a simple wallet system can be built around safe transaction handling. It is not only a CRUD example. The code focuses on a few important ideas that appear in real financial systems. It shows how to keep related writes atomic, how to make retrying requests safe with idempotency keys, how to store amounts as quantized integers instead of floating-point values, how to model balance changes with double-entry ledger records, and how to reduce race conditions when more than one request tries to spend from the same wallet at the same time.

The project also uses a local-first setup so the full system can run on a developer machine with Docker. That makes it easy to start the API and database together, inspect the schema and seed data, run requests from Postman, and see how transactions behave without needing cloud services or external dependencies.

## Table Of Contents

- [Architecture](#architecture)
- [API Keys](#api-keys)
- [Admin Provisioning](#admin-provisioning)
- [Idempotency](#idempotency)
- [Atomicity](#atomicity)
- [Concurrency Control](#concurrency-control)
- [Amount Validation](#amount-validation)
- [Ledger Model](#ledger-model)
- [Balance Computation](#balance-computation)
- [Quantization And Currency](#quantization-and-currency)
- [Postman Examples](#postman-examples)
- [Set Up](#set-up)

## Architecture

The system separates control-plane access from money-movement access:

- Admin API keys are prefixed with `adm_`.
- User API keys are prefixed with `usr_`.
- Requests are authenticated through the `x-api-key` header.
- Admin keys can provision users and inspect system data.
- User keys can perform deposits, withdrawals, and transfers on wallets they own.

This split keeps operational privileges away from transactional privileges. Admin access is used for provisioning and oversight, while user access is used for money movement.

For local development, user keys are intentionally permissive and can be used across accounts so test flows are easier to run. This should be treated as a development shortcut only, not as a production access model. Admin and user keys are still not interchangeable: endpoints that require admin access must be called with an admin key.

## API Keys

Two API key configs are registered through Better Auth:

- `admin` with prefix `adm_`
- `user` with prefix `usr_`

The prefix is part of the authorization model. Request handling can classify a key as administrative or user-scoped before any business operation is executed.

Development key issuance endpoints:

- `GET /api/v1/admin/api-keys` returns a new admin key.
- `GET /api/v1/api-keys` returns a new user key.

Example:

```bash
curl -X GET http://localhost:3000/api/v1/admin/api-keys
curl -X GET http://localhost:3000/api/v1/api-keys
```

Use returned keys as:

```bash
curl -H "x-api-key: adm_..." http://localhost:3000/api/v1/users
curl -H "x-api-key: usr_..." http://localhost:3000/api/v1/wallets/deposit
```

In this project, these endpoints are intentionally simple for local development and testing. In a production system, key issuance would normally be restricted behind stronger operational controls and audit requirements.

## Admin Provisioning

Admins create users through `POST /api/v1/users`.

For development, user creation and wallet creation happen in the same database transaction:

- one user row is inserted
- one wallet row is inserted immediately for that user
- the API returns both resources together

This keeps onboarding simple in local environments and guarantees a newly created user is immediately wallet-backed.

The trade-off is intentional: the model collapses identity provisioning and wallet provisioning into one step so API consumers do not need a second setup flow before testing deposits, withdrawals, or transfers.

## Idempotency

All money-moving endpoints require an `Idempotency-Key` header:

- `POST /api/v1/wallets/deposit`
- `POST /api/v1/wallets/withdraw`
- `POST /api/v1/wallets/transfer`

The key is stored with:

- the caller identity
- the previous response status
- the previous response body
- an expiry time

If the same user retries with the same key before expiry, the cached response is returned instead of creating another transaction. This prevents duplicate deposits, withdrawals, and transfers during retries or network failures.

Idempotency is treated as part of the API contract, not as a client-side convenience. A caller can safely retry after timeouts or ambiguous failures without risking double execution of a financial operation.

## Atomicity

Each financial operation runs inside a database transaction.

Within one transaction we:

- create the transaction record
- insert all ledger entries
- refresh balance state
- commit or roll back as a unit

Either the full operation is persisted or none of it is. There is no partial state where a transaction exists without its ledger effects.

This is important because financial correctness depends on referential completeness. Transaction metadata, ledger movements, and balance visibility must advance together or not at all.

## Concurrency Control

For debit-sensitive flows such as withdrawals and transfers, the wallet row is pessimistically locked with `SELECT ... FOR UPDATE` before checking available balance.

This prevents concurrent requests from reading the same spendable balance and overspending the wallet.

An alternative design would be optimistic concurrency control using PostgreSQL MVCC, with deferred checks or deferred triggers evaluated before commit. That approach can reduce lock contention, but this project chooses explicit row locking because the behavior is simpler and easier to reason about for wallet debits.

The choice favors predictability over maximum concurrency. For a wallet system, making insufficient-funds checks deterministic under contention is often more important than extracting additional parallel write throughput.

## Amount Validation

Deposit, transfer, and withdrawal requests only accept positive amounts. Negative values are rejected at request validation time, and amounts are also constrained to the supported precision.

For debit flows, the system checks that the wallet can cover the full debit before writing ledger entries:

- transfer checks `amount + fee`
- withdrawal checks `amount + fee`
- deposit does not allow a negative amount that could act like a disguised debit
- withdrawal does not allow some clever folks to illegally add their balances by withdrawing negative amounts
- transfers do not allow an illegal negative transfer that might siphon money from a poor soul's wallet into the initiating wallet

This prevents two common failure modes:

- using negative inputs to invert transaction meaning
- allowing a wallet to spend the principal amount but not the related fee

In practice, a transfer or withdrawal is only accepted when the wallet has enough balance to absorb both the requested amount and any fee charged by the operation.

## Ledger Model

Balances are derived from ledger entries, not mutated directly.

- every business transaction creates one `transactions` row
- that transaction is decomposed into one or more `ledger_entries`
- ledger entry amounts must sum to zero

Deposits and withdrawals are modeled as transfers against system wallets:

- deposit = external source wallet -> user wallet
- withdrawal = user wallet -> external sink wallet
- transfer = sender wallet -> receiver wallet + fee wallet

This abstraction gives one consistent movement model, preserves double-entry semantics, and makes zero-sum validation explicit.

Modeling deposits and withdrawals as transfers avoids special-case balance logic. Every financial event becomes a composition of ledger movements between wallets, including system-managed wallets that represent sources, sinks, or fees.

## Balance Computation

Wallet balances are read from the `wallet_balances` materialized view, which aggregates ledger entry amounts per wallet.

The ledger remains the source of truth; the balance view is the read model.

This keeps write-path logic centered on immutable ledger inserts while giving the API a cheaper balance lookup surface. The view exists for read efficiency, not as an independent state store.

## Quantization And Currency

Amounts are quantized into integer micro-units using a scale factor of `10^6`.

- API inputs and outputs use display amounts
- internal storage uses `BIGINT`
- ledger math stays integer-safe

This matters for multi-currency systems because fractional precision varies by currency. Quantization avoids floating-point drift and makes it possible to support currency-specific precision rules without changing the ledger model.

Even when the current examples use a single currency, the storage model should assume heterogeneous precision from the start. Integer quantization is the foundation that allows currency-aware rounding and settlement rules to be introduced safely later.

## Set Up

The project runs in Docker using `docker-compose`. Startup brings up the API and PostgreSQL together, and the database is initialized from the bundled setup SQL so schema objects and seed data are available immediately.

To start the API stack:
```bash
cp .env.example .env
chmod +x init-db/*.sh
docker-compose up --build
```

This boot flow applies the database init script during container startup, so the app starts against a pre-created schema, materialized view, and seeded system wallets.

To stop the containers and tear down volumes:
```bash
docker-compose down -v
```

Required system wallet ids are provided through:

- `SYSTEM_FEE_WALLET_ID`
- `SYSTEM_DEPOSIT_WALLET_ID`
- `SYSTEM_WITHDRAWAL_WALLET_ID`


## Postman Examples

The examples below mirror the local test flow and can be copied into Postman as individual requests. Set `{{baseUrl}}` to `http://localhost:3000`.

### 1. Create Admin API Key

`GET {{baseUrl}}/api/v1/admin/api-keys`

Headers:

- none

Body:

- none

Example response:

```json
{
  "key": "adm_xxx",
  "apiKeyId": "..."
}
```

### 2. Create User API Key

`GET {{baseUrl}}/api/v1/api-keys`

Headers:

- none

Body:

- none

Example response:

```json
{
  "key": "usr_xxx",
  "apiKeyId": "..."
}
```

### 3. Create User And Wallet

`POST {{baseUrl}}/api/v1/users`

Headers:

- `Content-Type: application/json`
- `x-api-key: {{adminKey}}`

Body:

```json
{
  "name": "Alice Wanjiku",
  "email": "alice@example.com"
}
```

Example response:

```json
{
  "user": {
    "id": "...",
    "name": "Alice Wanjiku",
    "email": "alice@example.com"
  },
  "wallet": {
    "id": "...",
    "currency": "KES",
    "createdAt": "..."
  }
}
```

Repeat the same request for a second user, for example `Bob Kamau`, and save both wallet ids for later requests.

### 4. Deposit Funds

`POST {{baseUrl}}/api/v1/wallets/deposit`

Headers:

- `Content-Type: application/json`
- `x-api-key: {{userKey}}`
- `Idempotency-Key: deposit-alice-001`

Body:

```json
{
  "walletId": "{{aliceWalletId}}",
  "amount": 10000
}
```

Example response:

```json
{
  "transactionId": "...",
  "status": "success",
  "walletId": "{{aliceWalletId}}",
  "amount": 10000
}
```

### 5. Transfer Funds

`POST {{baseUrl}}/api/v1/wallets/transfer`

Headers:

- `Content-Type: application/json`
- `x-api-key: {{userKey}}`
- `Idempotency-Key: transfer-alice-bob-001`

Body:

```json
{
  "senderId": "{{aliceWalletId}}",
  "receiverId": "{{bobWalletId}}",
  "amount": 2500
}
```

Example response:

```json
{
  "transactionId": "...",
  "status": "success",
  "amount": 2500,
  "fee": 25
}
```

### 6. Withdraw Funds

`POST {{baseUrl}}/api/v1/wallets/withdraw`

Headers:

- `Content-Type: application/json`
- `x-api-key: {{userKey}}`
- `Idempotency-Key: withdraw-alice-001`

Body:

```json
{
  "walletId": "{{aliceWalletId}}",
  "amount": 1000
}
```

Example response:

```json
{
  "transactionId": "...",
  "status": "success",
  "walletId": "{{aliceWalletId}}",
  "amount": 1000,
  "fee": 10
}
```

### 7. Read Wallet Balance

`GET {{baseUrl}}/api/v1/wallets/{{aliceWalletId}}/balance`

Headers:

- `x-api-key: {{userKey}}`

Body:

- none

Example response:

```json
{
  "walletId": "{{aliceWalletId}}",
  "balance": 6465
}
```

After a deposit of `10000`, a transfer of `2500` with a `25` transfer fee, and a withdrawal of `1000` with a `10` withdrawal fee, the expected balance is `6465`.

### 8. Read Wallet Transactions

`GET {{baseUrl}}/api/v1/wallets/{{aliceWalletId}}/transactions?limit=10&offset=0`

Headers:

- `x-api-key: {{userKey}}`

Body:

- none

Example response:

```json
{
  "items": [
    {
      "id": "tx_deposit_001",
      "type": "DEPOSIT",
      "status": "COMPLETED",
      "createdAt": "2026-03-17T10:00:00.000Z",
      "subTransactions": [
        {
          "id": "le_deposit_user",
          "walletId": "{{aliceWalletId}}",
          "amount": 10000,
          "entryType": "CREDIT",
          "narration": "Deposit to wallet",
          "createdAt": "2026-03-17T10:00:00.000Z"
        },
        {
          "id": "le_deposit_system",
          "amount": 10000,
          "entryType": "DEBIT",
          "narration": "External deposit source",
          "createdAt": "2026-03-17T10:00:00.000Z"
        }
      ]
    },
    {
      "id": "tx_transfer_001",
      "type": "TRANSFER",
      "status": "COMPLETED",
      "createdAt": "2026-03-17T10:05:00.000Z",
      "subTransactions": [
        {
          "id": "le_transfer_debit",
          "walletId": "{{aliceWalletId}}",
          "amount": 2525,
          "entryType": "DEBIT",
          "narration": "Debit: Transfer to {{bobWalletId}}",
          "createdAt": "2026-03-17T10:05:00.000Z"
        },
        {
          "id": "le_transfer_credit",
          "walletId": "{{bobWalletId}}",
          "amount": 2500,
          "entryType": "CREDIT",
          "narration": "Credit: Transfer from {{aliceWalletId}}",
          "createdAt": "2026-03-17T10:05:00.000Z"
        },
        {
          "id": "le_transfer_fee",
          "amount": 25,
          "entryType": "CREDIT",
          "narration": "Processing Fee",
          "createdAt": "2026-03-17T10:05:00.000Z"
        }
      ]
    },
    {
      "id": "tx_withdrawal_001",
      "type": "WITHDRAWAL",
      "status": "COMPLETED",
      "createdAt": "2026-03-17T10:10:00.000Z",
      "subTransactions": [
        {
          "id": "le_withdrawal_user",
          "walletId": "{{aliceWalletId}}",
          "amount": 1010,
          "entryType": "DEBIT",
          "narration": "Withdrawal from wallet",
          "createdAt": "2026-03-17T10:10:00.000Z"
        },
        {
          "id": "le_withdrawal_system",
          "amount": 1000,
          "entryType": "CREDIT",
          "narration": "External withdrawal destination",
          "createdAt": "2026-03-17T10:10:00.000Z"
        },
        {
          "id": "le_withdrawal_fee",
          "amount": 10,
          "entryType": "CREDIT",
          "narration": "Processing Fee",
          "createdAt": "2026-03-17T10:10:00.000Z"
        }
      ]
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0
  }
}
```

System wallets are intentionally masked in these nested entries. When `walletId` is omitted, the row belongs to an internal source, sink, or fee wallet.

The nested structure is the API representation of the underlying ledger transaction:

- a `DEPOSIT` contains a credit into the user wallet and a balancing debit from an internal source wallet
- a `WITHDRAWAL` contains a debit from the user wallet and a balancing credit into an internal sink wallet
- a `TRANSFER` contains a debit from the sender, a credit to the receiver, and a credit to the fee wallet

These nested rows are the components of one business transaction. Read them together, not independently. The sum of all nested amounts still resolves to a zero-sum movement across participating wallets.

System accounts are masked so client-facing responses expose the business effect of the transaction without leaking internal wallet identifiers. The internal source, withdrawal sink, and fee wallets still participate in the ledger and still enforce balance conservation; they are only hidden at the response layer.

### 9. Read All Transactions

`GET {{baseUrl}}/api/v1/transactions?limit=50`

Headers:

- `x-api-key: {{adminKey}}`

Body:

- none

Example response:

```json
{
  "items": [
    {
      "id": "tx_deposit_001",
      "type": "DEPOSIT",
      "status": "COMPLETED",
      "createdAt": "2026-03-17T10:00:00.000Z",
      "ledgerEntries": [
        {
          "id": "le_deposit_user",
          "walletId": "{{aliceWalletId}}",
          "amount": 10000,
          "entryType": "CREDIT",
          "narration": "Deposit to wallet",
          "createdAt": "2026-03-17T10:00:00.000Z"
        },
        {
          "id": "le_deposit_system",
          "amount": 10000,
          "entryType": "DEBIT",
          "narration": "External deposit source",
          "createdAt": "2026-03-17T10:00:00.000Z"
        }
      ]
    },
    {
      "id": "tx_transfer_001",
      "type": "TRANSFER",
      "status": "COMPLETED",
      "createdAt": "2026-03-17T10:05:00.000Z",
      "ledgerEntries": [
        {
          "id": "le_transfer_debit",
          "walletId": "{{aliceWalletId}}",
          "amount": 2525,
          "entryType": "DEBIT",
          "narration": "Debit: Transfer to {{bobWalletId}}",
          "createdAt": "2026-03-17T10:05:00.000Z"
        },
        {
          "id": "le_transfer_credit",
          "walletId": "{{bobWalletId}}",
          "amount": 2500,
          "entryType": "CREDIT",
          "narration": "Credit: Transfer from {{aliceWalletId}}",
          "createdAt": "2026-03-17T10:05:00.000Z"
        },
        {
          "id": "le_transfer_fee",
          "amount": 25,
          "entryType": "CREDIT",
          "narration": "Processing Fee",
          "createdAt": "2026-03-17T10:05:00.000Z"
        }
      ]
    },
    {
      "id": "tx_withdrawal_001",
      "type": "WITHDRAWAL",
      "status": "COMPLETED",
      "createdAt": "2026-03-17T10:10:00.000Z",
      "ledgerEntries": [
        {
          "id": "le_withdrawal_user",
          "walletId": "{{aliceWalletId}}",
          "amount": 1010,
          "entryType": "DEBIT",
          "narration": "Withdrawal from wallet",
          "createdAt": "2026-03-17T10:10:00.000Z"
        },
        {
          "id": "le_withdrawal_system",
          "amount": 1000,
          "entryType": "CREDIT",
          "narration": "External withdrawal destination",
          "createdAt": "2026-03-17T10:10:00.000Z"
        },
        {
          "id": "le_withdrawal_fee",
          "amount": 10,
          "entryType": "CREDIT",
          "narration": "Processing Fee",
          "createdAt": "2026-03-17T10:10:00.000Z"
        }
      ]
    }
  ],
  "nextCursor": null
}
```

The admin transaction feed uses the same nested ledger concept, but grouped under `ledgerEntries` instead of `subTransactions`.

Masking still applies in the admin feed shown here. Internal system accounts are represented by entries without `walletId`, while user-facing wallets retain their identifiers. This keeps the response readable while preserving the shape of the complete accounting event.

Recommended Postman variables:

- `baseUrl`
- `adminKey`
- `userKey`
- `aliceWalletId`
- `bobWalletId`
