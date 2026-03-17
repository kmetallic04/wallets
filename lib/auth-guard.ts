import { ApiError } from "@/lib/errors";
import { headers } from "next/headers";

export type AuthContext = {
  userId: string | null;
  apiKeyId: string;
  configId: string;
  isAdmin: boolean;
};

export async function requireApiKey(
  requireAdmin = false,
): Promise<AuthContext> {
  const hdrs = await headers();
  const key = hdrs.get("x-api-key");

  if (!key) {
    throw new ApiError("Missing API key", 401, "MISSING_API_KEY");
  }

  const isAdmin = key.startsWith("adm_");
  const isUser = key.startsWith("usr_") || key.startsWith("user_");

  if (!isAdmin && !isUser) {
    throw new ApiError("Invalid API key prefix", 401, "INVALID_API_KEY");
  }

  if (requireAdmin && !isAdmin) {
    throw new ApiError("Forbidden", 403, "FORBIDDEN");
  }

  return {
    userId: isUser ? "00000000-0000-0000-0000-000000000000" : null,
    apiKeyId: key,
    configId: isAdmin ? "admin" : "user",
    isAdmin,
  };
}

