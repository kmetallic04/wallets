# Wallets API

Headless wallet API built with Next.js, PostgreSQL, Drizzle ORM, and Better Auth API keys.

## Table Of Contents

- [Architecture](#architecture)
- [API Keys](#api-keys)
- [Admin Provisioning](#admin-provisioning)
- [Idempotency](#idempotency)
- [Atomicity](#atomicity)
- [Concurrency Control](#concurrency-control)
- [Ledger Model](#ledger-model)
- [Balance Computation](#balance-computation)
- [Quantization And Currency](#quantization-and-currency)
- [Local Run](#local-run)

## Architecture

The system separates control-plane access from money-movement access:

- Admin API keys are prefixed with `adm_`.
- User API keys are prefixed with `usr_`.
- Requests are authenticated through the `x-api-key` header.
- Admin keys can provision users and inspect system data.
- User keys can perform deposits, withdrawals, and transfers on wallets they own.

This split keeps operational privileges away from transactional privileges. Admin access is used for provisioning and oversight, while user access is constrained to wallet actions scoped to owned accounts.

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

## Local Run

The project runs in Docker using `docker-compose`. Startup brings up the API and PostgreSQL together, and the database is initialized from the bundled setup SQL so schema objects and seed data are available immediately.

To start the API stack:
```bash
cp .env.example .env
chmod +x init-db/*.sh
docker-compose up --build
```

This boot flow applies the database init script during container startup, so the app starts against a pre-created schema, materialized view, and seeded system wallets.

To stop the containers and remove volumes:
```bash
docker-compose down -v
```

Required system wallet ids are provided through:

- `SYSTEM_FEE_WALLET_ID`
- `SYSTEM_DEPOSIT_WALLET_ID`
- `SYSTEM_WITHDRAWAL_WALLET_ID`
