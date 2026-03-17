import { z } from "zod";

const uuidSchema = z.string().uuid();

const positiveAmountSchema = z
  .number()
  .positive()
  .refine(
    (value) => {
      const s = value.toString();
      const [, decimals] = s.split(".");
      return !decimals || decimals.length <= 6;
    },
    { message: "Amount must have at most 6 decimal places" },
  );

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export const transferSchema = z.object({
  senderId: uuidSchema,
  receiverId: uuidSchema,
  amount: positiveAmountSchema,
});

export const depositSchema = z.object({
  walletId: uuidSchema,
  amount: positiveAmountSchema,
});

export const withdrawalSchema = z.object({
  walletId: uuidSchema,
  amount: positiveAmountSchema,
});

export const paginationSchema = z.object({
  limit: z
    .string()
    .transform((v) => Number(v))
    .refine(
      (n) => Number.isInteger(n) && n > 0 && n <= 200,
      "limit must be an integer between 1 and 200",
    )
    .default(50),
  offset: z
    .string()
    .transform((v) => Number(v))
    .refine(
      (n) => Number.isInteger(n) && n >= 0,
      "offset must be a non-negative integer",
    )
    .default(0),
});

export const cursorPaginationSchema = z.object({
  limit: z
    .string()
    .transform((v) => Number(v))
    .refine(
      (n) => Number.isInteger(n) && n > 0 && n <= 500,
      "limit must be an integer between 1 and 500",
    )
    .default(100),
  cursor: uuidSchema.optional(),
});

