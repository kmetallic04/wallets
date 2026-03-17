import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { walletBalances, wallets } from "@/db/schema";
import { requireApiKey } from "@/lib/auth-guard";
import { Quantizer } from "@/lib/quantization";
import { eq } from "drizzle-orm";
import { ApiError } from "@/lib/errors";

export async function GET(
  _req: NextRequest,
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
    // User keys are therefore allowed to read wallet balances.

    const [row] = await db
      .select()
      .from(walletBalances)
      .where(eq(walletBalances.walletId, walletId));

    const balance = row?.balance ?? BigInt(0);

    return NextResponse.json(
      {
        walletId,
        balance: Quantizer.toDisplay(BigInt(balance)),
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
