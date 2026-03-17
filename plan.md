This is aheadless api-only wallets system to be built. Structure:
/app/api/
  ├── v1/
  │   └── wallets/
  │       ├── [id]/
  │       │   └── balance/route.ts
  │       └── transfer/route.ts
  └── v2/
      └── (future logic)

Here is a complete architectural recap of the wallet API. By explicitly versioning the routes (using a /v1/ prefix) and shifting to Drizzle ORM, the design is positioned for clean iterations and high-performance, type-safe database interactions.Relying on PostgreSQL’s native MVCC rather than explicit row-level locking is a solid approach for maximizing read/write throughput, provided the transaction isolation levels or constraint triggers are configured to catch concurrent overdrafts.1. System Architecture & StackFramework: Next.js (App Router) with Route Handlers.Database: PostgreSQL.ORM: Drizzle ORM.Validation: Zod (Strict schema parsing).Authentication: better-auth (API Key plugin, headless/no UI).State Management: Double-entry ledger (ledger_entries) with a Materialized View (wallet_balances).2. API Endpoints Specification (v1)1. Execute a TransferEndpoint: POST /api/v1/wallets/transferAuth: API Key Required.Headers: x-api-key, Idempotency-Key (Required).Functionality:Idempotency Check: Queries the idempotency table. If the key exists, returns the cached response immediately.Zod Validation: Enforces payload structure. Rejects negative or zero amounts.Balance Check: Calculates the current balance (Principal + Fees) to ensure sufficient funds.Drizzle Transaction: Opens an ACID transaction to write the double-entry splits (Debit Sender, Credit Receiver, Credit System Fee).Zero-Sum Guarantee: Relies on a PostgreSQL deferred constraint trigger to ensure the splits equal exactly 0 before committing.View Refresh: Triggers a REFRESH MATERIALIZED VIEW CONCURRENTLY for the balances view immediately after the transaction commits.Payload Schema (Zod):TypeScriptz.object({
  senderId: z.string().uuid(),
  receiverId: z.string().uuid(),
  amount: z.number().positive(),
})
2. Check Account BalanceEndpoint: GET /api/v1/wallets/:walletId/balanceAuth: API Key Required (Scoped to the wallet owner or Admin).Functionality:Validates the API key.Queries the wallet_balances Materialized View.Returns an $O(1)$ lookup of the pre-calculated balance and the timestamp of the last transaction.3. View Wallet TransactionsEndpoint: GET /api/v1/wallets/:walletId/transactionsAuth: API Key Required (Scoped to the wallet owner or Admin).Query Params: ?limit=50&offset=0 (Pagination).Functionality:Validates the API key.Queries the ledger_entries table filtered by walletId.Returns the localized ledger history (debits, credits, fees) specific to that user.4. View All Transactions (Global Ledger)Endpoint: GET /api/v1/transactionsAuth: API Key Required (Strictly Admin/System Scope).Query Params: ?limit=100&cursor=uuid (Cursor-based pagination recommended for large datasets).Functionality:Validates the API key and explicitly checks for an admin role or read:global_ledger metadata scope.Queries the parent transactions table joined with ledger_entries.Returns the immutable audit trail of the entire system.

lib/quantization.ts:
typescriptconst SCALE_FACTOR = 1_000_000n; // 10^6

export const Quantizer = {
  /** Converts a float string or number to micro-units BigInt */
  toInternal: (amount: number | string): bigint => {
    return BigInt(Math.round(Number(amount) * Number(SCALE_FACTOR)));
  },
  /** Converts micro-units BigInt back to a display float */
  toDisplay: (amount: bigint): number => {
    return Number(amount) / Number(SCALE_FACTOR);
  }
};

lib/ledger-helper.ts
typescriptimport { ledgerEntries } from "@/db/schema";
import { db } from "@/db";

type Split = {
  walletId: string;
  amount: bigint;
  narration: string;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertBalancedSplits(splits: Split[]): void {
  const sum = splits.reduce((acc, s) => acc + s.amount, 0n);
  if (sum !== 0n) {
    throw new Error(
      `Unbalanced ledger: entries sum to ${sum} micro-units, expected 0`
    );
  }
}

export async function insertLedgerSplits(
  tx: Tx,
  transactionId: string,
  splits: Split[]
): Promise<void> {
  assertBalancedSplits(splits);

  await tx.insert(ledgerEntries).values(
    splits.map((s) => ({
      transactionId,
      walletId: s.walletId,
      amount: s.amount,
      entryType: s.amount < 0n ? "DEBIT" : "CREDIT",
      narration: s.narration,
    }))
  );
}

/transaction route
import { db } from "@/db";
import { wallets, ledgerEntries, walletBalances } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function executeTransfer(
  senderId: string,
  receiverId: string,
  rawAmount: number
) {
  const amount = Quantizer.toInternal(rawAmount);
  const fee = amount / 100n; // 1%
  const totalDebit = amount + fee;

  return await db.transaction(async (tx) => {
    // 1. Lock the Sender Row (Pessimistic Locking)
    await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, senderId))
      .for("update");

    // 2. Check Balance within the Transaction
    const [balanceRow] = await tx
      .select({ balance: walletBalances.balance })
      .from(walletBalances)
      .where(eq(walletBalances.walletId, senderId));

    const currentBalance = BigInt(balanceRow?.balance ?? 0);
    if (currentBalance < totalDebit) {
      throw new Error("Insufficient funds for transfer and fees");
    }

    // 3. Insert Ledger Splits using our Helper
    const transactionId = crypto.randomUUID();
    await insertLedgerSplits(tx, transactionId, [
      {
        walletId: senderId,
        amount: -totalDebit,
        narration: `Debit: Transfer to ${receiverId}`,
      },
      {
        walletId: receiverId,
        amount: amount,
        narration: `Credit: Transfer from ${senderId}`,
      },
      {
        walletId: process.env.SYSTEM_FEE_ID!,
        amount: fee,
        narration: `Processing Fee`,
      },
    ]);

    // 4. Refresh Materialized View
    await tx.refreshMaterializedView(walletBalances).concurrently();

    return { transactionId, status: "success" };
  });
}

// db/schema.ts
export const walletBalances = pgMaterializedView("wallet_balances", {
  walletId: uuid("wallet_id"),
  balance: bigint("balance", { mode: "bigint" }),
}).existing();

