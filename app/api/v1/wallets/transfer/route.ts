import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, walletBalances, wallets } from "@/db/schema";
import { requireApiKey } from "@/lib/auth-guard";
import { Quantizer } from "@/lib/quantization";
import { insertLedgerSplits } from "@/lib/ledger-helper";
import { checkIdempotency, saveIdempotency } from "@/lib/idempotency";
import { transferSchema } from "@/lib/zod-schemas";
import { eq } from "drizzle-orm";
import { ApiError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const authCtx = await requireApiKey(false);

    if (authCtx.isAdmin) {
      return NextResponse.json(
        { error: "Admin keys cannot perform transfers", code: "FORBIDDEN" },
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
    const parsed = transferSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", code: "INVALID_PAYLOAD", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { senderId, receiverId, amount } = parsed.data;

    if (senderId === receiverId) {
      return NextResponse.json(
        { error: "Sender and receiver cannot be the same", code: "SELF_TRANSFER" },
        { status: 400 },
      );
    }

    const internalAmount = Quantizer.toInternal(amount);
    const fee = internalAmount / 100n; // 1%
    const totalDebit = internalAmount + fee;

    const systemFeeWalletId = process.env.SYSTEM_FEE_WALLET_ID;
    if (!systemFeeWalletId) {
      return NextResponse.json(
        { error: "System fee wallet not configured", code: "MISSING_SYSTEM_FEE_WALLET" },
        { status: 500 },
      );
    }

    const result = await db.transaction(async (tx) => {
      const [senderWallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, senderId))
        .for("update");

      if (!senderWallet) {
        throw new ApiError("Sender wallet not found", 404, "SENDER_NOT_FOUND");
      }
      // TODO: Enforce transferrer ownership/authorization for sender wallet.

      const [balanceRow] = await tx
        .select({ balance: walletBalances.balance })
        .from(walletBalances)
        .where(eq(walletBalances.walletId, senderId));

      const currentBalance = BigInt(balanceRow?.balance ?? 0n);
      if (currentBalance < totalDebit) {
        throw new ApiError("Insufficient funds", 422, "INSUFFICIENT_FUNDS");
      }

      const [receiverWallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, receiverId));

      if (!receiverWallet) {
        throw new ApiError("Receiver wallet not found", 404, "RECEIVER_NOT_FOUND");
      }
      // TODO: Enforce transferrer authorization for receiver wallet access.

      const [txRow] = await tx
        .insert(transactions)
        .values({
          type: "TRANSFER",
          status: "COMPLETED",
        })
        .returning({ id: transactions.id });

      const transactionId = txRow.id;

      await insertLedgerSplits(tx, transactionId, [
        {
          walletId: senderId,
          amount: -totalDebit,
          narration: `Debit: Transfer to ${receiverId}`,
        },
        {
          walletId: receiverId,
          amount: internalAmount,
          narration: `Credit: Transfer from ${senderId}`,
        },
        {
          walletId: systemFeeWalletId,
          amount: fee,
          narration: "Processing Fee",
        },
      ]);

      await tx.refreshMaterializedView(walletBalances).concurrently();

      return { transactionId, amount, fee };
    });

    const responseBody = {
      transactionId: result.transactionId,
      status: "success",
      amount: amount,
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

