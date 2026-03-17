import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ledgerEntries, transactions } from "@/db/schema";
import { requireApiKey } from "@/lib/auth-guard";
import { Quantizer } from "@/lib/quantization";
import { cursorPaginationSchema } from "@/lib/zod-schemas";
import { and, desc, eq, gt } from "drizzle-orm";
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

    const rows = await db
      .select({
        id: transactions.id,
        type: transactions.type,
        status: transactions.status,
        createdAt: transactions.createdAt,
        ledgerId: ledgerEntries.id,
        walletId: ledgerEntries.walletId,
        amount: ledgerEntries.amount,
        entryType: ledgerEntries.entryType,
        narration: ledgerEntries.narration,
      })
      .from(transactions)
      .innerJoin(
        ledgerEntries,
        eq(ledgerEntries.transactionId, transactions.id),
      )
      .where(whereClause as any)
      .orderBy(desc(transactions.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null;

    const items = pageRows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      createdAt: row.createdAt,
      ledgerEntry: {
        id: row.ledgerId,
        walletId: row.walletId,
        amount: Quantizer.toDisplay(BigInt(row.amount)),
        entryType: row.entryType,
        narration: row.narration,
      },
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

