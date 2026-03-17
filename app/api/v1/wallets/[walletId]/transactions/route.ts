import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ledgerEntries, transactions, wallets } from "@/db/schema";
import { requireApiKey } from "@/lib/auth-guard";
import { paginationSchema } from "@/lib/zod-schemas";
import { groupAndMaskLedgerEntries } from "@/lib/ledger-masking";
import { desc, eq, inArray } from "drizzle-orm";
import { ApiError } from "@/lib/errors";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ walletId: string }> },
) {
  try {
    const authCtx = await requireApiKey(false);
    const { walletId } = await params;

    if (!walletId) {
      return NextResponse.json(
        { error: "Missing walletId", code: "MISSING_WALLET_ID" },
        { status: 400 },
      );
    }

    // In prefix-only auth mode, keys do not map to wallet ownership.
    // User keys are therefore allowed to read wallet transactions.

    const url = new URL(req.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const parsed = paginationSchema.safeParse(query);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid pagination",
          code: "INVALID_PAGINATION",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const limit = Number(parsed.data.limit);
    const offset = Number(parsed.data.offset);

    const transactionRows = await db
      .select({
        transactionId: transactions.id,
        createdAt: transactions.createdAt,
        txType: transactions.type,
        txStatus: transactions.status,
      })
      .from(transactions)
      .innerJoin(ledgerEntries, eq(ledgerEntries.transactionId, transactions.id))
      .where(eq(ledgerEntries.walletId, walletId))
      .orderBy(desc(transactions.createdAt))
      .limit(limit)
      .offset(offset);

    const dedupedTransactions: typeof transactionRows = [];
    const seen = new Set<string>();
    for (const row of transactionRows) {
      if (seen.has(row.transactionId)) continue;
      seen.add(row.transactionId);
      dedupedTransactions.push(row);
    }

    const txIds = dedupedTransactions.map((row) => row.transactionId);
    const subTransactionRows =
      txIds.length === 0
        ? []
        : await db
            .select({
              id: ledgerEntries.id,
              transactionId: ledgerEntries.transactionId,
              walletId: ledgerEntries.walletId,
              amount: ledgerEntries.amount,
              entryType: ledgerEntries.entryType,
              narration: ledgerEntries.narration,
              createdAt: ledgerEntries.createdAt,
            })
            .from(ledgerEntries)
            .where(inArray(ledgerEntries.transactionId, txIds))
            .orderBy(desc(ledgerEntries.createdAt));

    const txTypeById = new Map(
      dedupedTransactions.map((row) => [row.transactionId, row.txType]),
    );
    const subTransactionsByTransactionId = groupAndMaskLedgerEntries(subTransactionRows, txTypeById);

    const items = dedupedTransactions.map((row) => ({
      id: row.transactionId,
      type: row.txType,
      status: row.txStatus,
      createdAt: row.createdAt,
      subTransactions: subTransactionsByTransactionId.get(row.transactionId) ?? [],
    }));

    return NextResponse.json(
      {
        items,
        pagination: { limit, offset },
      },
      { status: 200 },
    );
  } catch (err: any) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
