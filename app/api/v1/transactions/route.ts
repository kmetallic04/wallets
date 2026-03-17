import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ledgerEntries, transactions } from "@/db/schema";
import { requireApiKey } from "@/lib/auth-guard";
import { cursorPaginationSchema } from "@/lib/zod-schemas";
import { groupAndMaskLedgerEntries } from "@/lib/ledger-masking";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { ApiError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    const authCtx = await requireApiKey(true);

    if (!authCtx.isAdmin) {
      return NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403 },
      );
    }

    const url = new URL(req.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const parsed = cursorPaginationSchema.safeParse(query);

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
    const cursor = parsed.data.cursor ?? null;

    const conditions = [];
    if (cursor) {
      conditions.push(gt(transactions.id, cursor));
    }

    const whereClause =
      conditions.length === 0 ? undefined : and(...(conditions as [any, ...any[]]));

    const txRows = await db
      .select({
        id: transactions.id,
        type: transactions.type,
        status: transactions.status,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .where(whereClause as any)
      .orderBy(desc(transactions.createdAt))
      .limit(limit + 1);

    const hasMore = txRows.length > limit;
    const pageTxRows = hasMore ? txRows.slice(0, limit) : txRows;
    const nextCursor = hasMore ? pageTxRows[pageTxRows.length - 1]?.id ?? null : null;

    const txIds = pageTxRows.map((row) => row.id);
    const ledgerRows =
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

    const txTypeById = new Map(pageTxRows.map((row) => [row.id, row.type]));
    const ledgerByTransaction = groupAndMaskLedgerEntries(ledgerRows, txTypeById);

    const items = pageTxRows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      createdAt: row.createdAt,
      ledgerEntries: ledgerByTransaction.get(row.id) ?? [],
    }));

    return NextResponse.json(
      {
        items,
        nextCursor,
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

