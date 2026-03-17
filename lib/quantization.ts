import { ApiError } from "./errors";

const SCALE_FACTOR = BigInt(1_000_000); // 10^6

export const Quantizer = {
  toInternal(amount: number | string): bigint {
    const n = Number(amount);
    if (!Number.isFinite(n)) {
      throw new ApiError("Amount must be a finite number", 422, "INVALID_AMOUNT");
    }
    return BigInt(Math.round(n * Number(SCALE_FACTOR)));
  },
  toDisplay(amount: bigint): number {
    return Number(amount) / Number(SCALE_FACTOR);
  },
} as const;

