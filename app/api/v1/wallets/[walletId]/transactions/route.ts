import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ledgerEntries, transactions, wallets } from "@/db/schema";
import { requireApiKey } from "@/lib/auth-guard";
import { Quantizer } from "@/lib/quantization";
import { paginationSchema } from "@/lib/zod-schemas";
import { desc, eq } from "drizzle-orm";
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

    const rows = await db
      .select({
        id: ledgerEntries.id,
        transactionId: ledgerEntries.transactionId,
        walletId: ledgerEntries.walletId,
        amount: ledgerEntries.amount,
        entryType: ledgerEntries.entryType,
        narration: ledgerEntries.narration,
        createdAt: ledgerEntries.createdAt,
        txType: transactions.type,
        txStatus: transactions.status,
      })
      .from(ledgerEntries)
      .innerJoin(
        transactions,
        eq(ledgerEntries.transactionId, transactions.id),
      )
      .where(eq(ledgerEntries.walletId, walletId))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(limit)
      .offset(offset);

    const items = rows.map((row) => ({
      id: row.id,
      transactionId: row.transactionId,
      walletId: row.walletId,
      amount: Quantizer.toDisplay(BigInt(row.amount)),
      entryType: row.entryType,
      narration: row.narration,
      createdAt: row.createdAt,
      transactionType: row.txType,
      transactionStatus: row.txStatus,
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
