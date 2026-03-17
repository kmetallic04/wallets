import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, walletBalances, wallets } from "@/db/schema";
import { requireApiKey } from "@/lib/auth-guard";
import { Quantizer } from "@/lib/quantization";
import { insertLedgerSplits } from "@/lib/ledger-helper";
import { checkIdempotency, saveIdempotency } from "@/lib/idempotency";
import { withdrawalSchema } from "@/lib/zod-schemas";
import { eq } from "drizzle-orm";
import { ApiError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const authCtx = await requireApiKey(false);

    if (authCtx.isAdmin) {
      return NextResponse.json(
        { error: "Admin keys cannot perform withdrawals", code: "FORBIDDEN" },
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
    const parsed = withdrawalSchema.safeParse(json);

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
    // TODO: Enforce withdrawer ownership/authorization for the target wallet.
    const internalAmount = Quantizer.toInternal(amount);
    const fee = internalAmount / 100n; // 1%
    const totalDebit = internalAmount + fee;

    const withdrawalWalletId = process.env.SYSTEM_WITHDRAWAL_WALLET_ID;
    if (!withdrawalWalletId) {
      return NextResponse.json(
        { error: "System withdrawal wallet not configured", code: "MISSING_SYSTEM_WITHDRAWAL_WALLET" },
        { status: 500 },
      );
    }

    const systemFeeWalletId = process.env.SYSTEM_FEE_WALLET_ID;
    if (!systemFeeWalletId) {
      return NextResponse.json(
        { error: "System fee wallet not configured", code: "MISSING_SYSTEM_FEE_WALLET" },
        { status: 500 },
      );
    }

    const result = await db.transaction(async (tx) => {
      const [walletRow] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, walletId))
        .for("update");

      if (!walletRow) {
        throw new ApiError("Wallet not found", 404, "WALLET_NOT_FOUND");
      }

      const [balanceRow] = await tx
        .select({ balance: walletBalances.balance })
        .from(walletBalances)
        .where(eq(walletBalances.walletId, walletId));

      const currentBalance = BigInt(balanceRow?.balance ?? 0n);
      if (currentBalance < totalDebit) {
        throw new ApiError("Insufficient funds", 422, "INSUFFICIENT_FUNDS");
      }

      const [txRow] = await tx
        .insert(transactions)
        .values({
          type: "WITHDRAWAL",
          status: "COMPLETED",
        })
        .returning({ id: transactions.id });

      const transactionId = txRow.id;

      await insertLedgerSplits(tx, transactionId, [
        {
          walletId,
          amount: -totalDebit,
          narration: "Withdrawal from wallet",
        },
        {
          walletId: withdrawalWalletId,
          amount: internalAmount,
          narration: "External withdrawal destination",
        },
        {
          walletId: systemFeeWalletId,
          amount: fee,
          narration: "Processing Fee",
        },
      ]);

      await tx.refreshMaterializedView(walletBalances).concurrently();

      return { transactionId, fee };
    });

    const responseBody = {
      transactionId: result.transactionId,
      status: "success",
      walletId,
      amount,
      fee: Quantizer.toDisplay(result.fee),
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
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}

