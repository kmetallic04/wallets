import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, walletBalances, wallets } from "@/db/schema";
import { requireApiKey } from "@/lib/auth-guard";
import { Quantizer } from "@/lib/quantization";
import { insertLedgerSplits } from "@/lib/ledger-helper";
import { checkIdempotency, saveIdempotency } from "@/lib/idempotency";
import { depositSchema } from "@/lib/zod-schemas";
import { ApiError } from "@/lib/errors";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const authCtx = await requireApiKey(false);

    if (authCtx.isAdmin) {
      return NextResponse.json(
        { error: "Admin keys cannot perform deposits", code: "FORBIDDEN" },
        { status: 403 },
      );
    }

    if (!authCtx.userId) {
      return NextResponse.json(
        { error: "Unauthenticated", code: "UNAUTHENTICATED" },
        { status: 401 },
      );
    }

    const idempotencyKey = req.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Missing Idempotency-Key header", code: "MISSING_IDEMPOTENCY" },
        { status: 400 },
      );
    }

    const cached = await checkIdempotency(idempotencyKey, authCtx.userId);
    if (cached) {
      return NextResponse.json(cached.body, { status: cached.status });
    }

    const json = await req.json();
    const parsed = depositSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", code: "INVALID_PAYLOAD", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { walletId, amount } = parsed.data;

    const [wallet] = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.id, walletId));

    if (!wallet) {
      return NextResponse.json(
        { error: "Wallet not found", code: "WALLET_NOT_FOUND" },
        { status: 404 },
      );
    }
    // TODO: Enforce depositor ownership/authorization for the target wallet.
    const internalAmount = Quantizer.toInternal(amount);

    const depositWalletId = process.env.SYSTEM_DEPOSIT_WALLET_ID;
    if (!depositWalletId) {
      return NextResponse.json(
        { error: "System deposit wallet not configured", code: "MISSING_SYSTEM_DEPOSIT_WALLET" },
        { status: 500 },
      );
    }

    const result = await db.transaction(async (tx) => {
      const [txRow] = await tx
        .insert(transactions)
        .values({
          type: "DEPOSIT",
          status: "COMPLETED",
        })
        .returning({ id: transactions.id });

      const transactionId = txRow.id;

      await insertLedgerSplits(tx, transactionId, [
        {
          walletId: depositWalletId,
          amount: -internalAmount,
          narration: "External deposit source",
        },
        {
          walletId,
          amount: internalAmount,
          narration: "Deposit to wallet",
        },
      ]);

      await tx.refreshMaterializedView(walletBalances).concurrently();

      return { transactionId };
    });

    const responseBody = {
      transactionId: result.transactionId,
      status: "success",
      walletId,
      amount,
    };

    await saveIdempotency(idempotencyKey, authCtx.userId, {
      status: 201,
      body: responseBody,
    });

    return NextResponse.json(responseBody, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: err, code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}

