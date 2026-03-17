import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgMaterializedView,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const transactionTypeEnum = pgEnum("transaction_type", [
  "TRANSFER",
  "DEPOSIT",
  "WITHDRAWAL",
]);

export const transactionStatusEnum = pgEnum("transaction_status", [
  "PENDING",
  "COMPLETED",
  "FAILED",
]);

export const entryTypeEnum = pgEnum("entry_type", ["DEBIT", "CREDIT"]);

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").default("user"),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const wallets = pgTable("wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  currency: text("currency").notNull().default("KES"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: transactionTypeEnum("type").notNull(),
  status: transactionStatusEnum("status").notNull().default("PENDING"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  walletId: uuid("wallet_id")
    .notNull()
    .references(() => wallets.id, { onDelete: "restrict" }),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  entryType: entryTypeEnum("entry_type").notNull(),
  narration: text("narration").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  userId: uuid("user_id").notNull(),
  responseStatus: bigint("response_status", { mode: "number" }).notNull(),
  responseBody: jsonb("response_body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const apiKeys = pgTable("apikey", {
  id: text("id").primaryKey(),
  configId: text("config_id").notNull(),
  name: text("name"),
  start: text("start"),
  prefix: text("prefix"),
  key: text("key").notNull(),
  referenceId: text("reference_id").notNull(),
  refillInterval: integer("refill_interval"),
  refillAmount: integer("refill_amount"),
  lastRefillAt: timestamp("last_refill_at", { withTimezone: true }),
  enabled: boolean("enabled").notNull().default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(false),
  rateLimitTimeWindow: integer("rate_limit_time_window"),
  rateLimitMax: integer("rate_limit_max"),
  requestCount: integer("request_count").notNull().default(0),
  remaining: integer("remaining"),
  lastRequest: timestamp("last_request", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  permissions: text("permissions"),
  metadata: text("metadata"),
});

export const walletBalances = pgMaterializedView("wallet_balances", {
  walletId: uuid("wallet_id"),
  balance: bigint("balance", { mode: "bigint" }),
}).existing();

