import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { ApiError } from "@/lib/errors";
import { generateApiKey } from "@/lib/api-key";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
const PREFIX = "adm_";

export async function GET() {
  try {
    const { raw, hashed, start } = await generateApiKey(PREFIX);
    const id = crypto.randomUUID();

    await db.insert(apiKeys).values({
      id,
      configId: "admin",
      prefix: PREFIX,
      start,
      key: hashed,
      referenceId: SYSTEM_USER_ID,
      enabled: true,
    });

    return NextResponse.json(
      { key: raw, apiKeyId: id },
      { status: 201 },
    );
  } catch (err: any) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: "Failed to create API key", code: "CREATE_API_KEY_FAILED" },
      { status: 500 },
    );
  }
}
