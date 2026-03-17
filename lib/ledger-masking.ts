import { Quantizer } from "@/lib/quantization";

type TransactionType = "TRANSFER" | "DEPOSIT" | "WITHDRAWAL";

const SYSTEM_WALLET_IDS = new Set([
  process.env.SYSTEM_DEPOSIT_WALLET_ID,
  process.env.SYSTEM_WITHDRAWAL_WALLET_ID,
  process.env.SYSTEM_FEE_WALLET_ID,
]);

export type MaskedLedgerEntry = {
  id: string;
  walletId?: string;
  amount: number;
  entryType: "DEBIT" | "CREDIT";
  narration: string;
  createdAt: Date;
};

type RawLedgerRow = {
  id: string;
  transactionId: string;
  walletId: string;
  amount: bigint;
  entryType: "DEBIT" | "CREDIT";
  narration: string;
  createdAt: Date;
};

function isSystemWallet(walletId: string): boolean {
  return SYSTEM_WALLET_IDS.has(walletId);
}

export function groupAndMaskLedgerEntries(
  ledgerRows: RawLedgerRow[],
  txTypeById: Map<string, TransactionType>,
): Map<string, MaskedLedgerEntry[]> {
  const grouped = new Map<string, MaskedLedgerEntry[]>();

  for (const row of ledgerRows) {
    const txType = txTypeById.get(row.transactionId);
    if (!txType) continue;

    const entry: MaskedLedgerEntry = {
      id: row.id,
      amount: Math.abs(Quantizer.toDisplay(BigInt(row.amount))),
      entryType: row.entryType,
      narration: row.narration,
      createdAt: row.createdAt,
    };

    if (!isSystemWallet(row.walletId)) {
      entry.walletId = row.walletId;
    }

    const existing = grouped.get(row.transactionId) ?? [];
    existing.push(entry);
    grouped.set(row.transactionId, existing);
  }

  return grouped;
}
