import { db } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { ApiError } from "./errors";

type Split = {
  walletId: string;
  amount: bigint;
  narration: string;
};

type Tx = Parameters<(typeof db)["transaction"]>[0] extends (
  tx: infer T,
) => any
  ? T
  : never;

function assertBalancedSplits(splits: Split[]): void {
  const sum = splits.reduce((acc, s) => acc + s.amount, 0n);
  if (sum !== 0n) {
    throw new ApiError(
      `Unbalanced ledger: entries sum to ${sum.toString()} micro-units, expected 0`,
      422,
      "UNBALANCED_LEDGER_SPLITS",
    );
  }
}

export async function insertLedgerSplits(
  tx: Tx,
  transactionId: string,
  splits: Split[],
): Promise<void> {
  assertBalancedSplits(splits);

  await tx
    .insert(ledgerEntries)
    .values(
      splits.map((s) => ({
        transactionId,
        walletId: s.walletId,
        amount: s.amount,
        entryType: (s.amount < 0n ? "DEBIT" : "CREDIT") as "DEBIT" | "CREDIT",
        narration: s.narration,
      })) as (typeof ledgerEntries.$inferInsert)[],
    );
}

