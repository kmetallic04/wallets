import { defaultKeyHasher } from "@better-auth/api-key";

type GeneratedApiKey = {
  raw: string;
  hashed: string;
  start: string;
};

export async function generateApiKey(prefix: string): Promise<GeneratedApiKey> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw =
    prefix +
    Array.from(bytes)
      .map((b) => b.toString(36))
      .join("")
      .slice(0, 40);

  const hashed = await defaultKeyHasher(raw);

  return {
    raw,
    hashed,
    start: raw.slice(0, 8),
  };
}
