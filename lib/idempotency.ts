import { db } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

type CachedResponse = {
  status: number;
  body: unknown;
};

export async function checkIdempotency(
  key: string,
  _userId: string,
): Promise<CachedResponse | null> {
  const now = new Date();

  const rows = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.key, key),
        gt(idempotencyKeys.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    status: Number(row.responseStatus),
    body: row.responseBody,
  };
}

export async function saveIdempotency(
  key: string,
  userId: string,
  response: CachedResponse,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);

  await db
    .insert(idempotencyKeys)
    .values({
      key,
      userId,
      responseStatus: response.status,
      responseBody: response.body as any,
      createdAt: now,
      expiresAt,
    })
    .onConflictDoNothing();
}

