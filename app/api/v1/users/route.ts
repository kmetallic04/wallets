import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, walletBalances, wallets } from "@/db/schema";
import { requireApiKey } from "@/lib/auth-guard";
import { ApiError } from "@/lib/errors";
import { Quantizer } from "@/lib/quantization";
import { createUserSchema, paginationSchema } from "@/lib/zod-schemas";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    await requireApiKey(true);

    const json = await req.json();
    const parsed = createUserSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", code: "INVALID_PAYLOAD", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { name, email } = parsed.data;

    const { user, wallet } = await db.transaction(async (tx) => {
      const userId = crypto.randomUUID();

      await tx.insert(users).values({
        id: userId,
        name,
        email,
      });

      const [walletRow] = await tx
        .insert(wallets)
        .values({
          userId,
          currency: "KES",
        })
        .returning();

      return {
        user: { id: userId, name, email },
        wallet: {
          id: walletRow.id,
          currency: walletRow.currency,
          createdAt: walletRow.createdAt,
        },
      };
    });

    return NextResponse.json({ user, wallet }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: "Failed to create user", code: "CREATE_USER_FAILED" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireApiKey(true);

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
        walletId: wallets.id,
        userId: wallets.userId,
        currency: wallets.currency,
        walletCreatedAt: wallets.createdAt,
        balance: walletBalances.balance,
      })
      .from(wallets)
      .leftJoin(walletBalances, eq(wallets.id, walletBalances.walletId))
      .limit(limit)
      .offset(offset);

    const items = rows.map((row) => ({
      userId: row.userId,
      wallet: {
        id: row.walletId,
        currency: row.currency,
        createdAt: row.walletCreatedAt,
        balance: Quantizer.toDisplay(BigInt(row.balance ?? 0n)),
      },
    }));

    return NextResponse.json(
      { items, pagination: { limit, offset } },
      { status: 200 },
    );
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
