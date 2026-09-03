/**
 * utils/format.ts
 * Shared formatting utilities.
 */

import { formatDistanceToNow, format } from "date-fns";

import { PaymentRecord } from "@/lib/stellar";

interface AssetFormatRule {
  minimumFractionDigits: number;
  maximumFractionDigits: number;
}

const DEFAULT_ASSET_CODE = "XLM";
const DEFAULT_ASSET_RULE: AssetFormatRule = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 7,
};
const ASSET_FORMAT_RULES: Record<string, AssetFormatRule> = {
  XLM: DEFAULT_ASSET_RULE,
  USDC: {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  },
};

function normalizeAssetCode(assetCode?: string): string {
  return assetCode?.trim().toUpperCase() || DEFAULT_ASSET_CODE;
}

function getAssetFormatRule(assetCode?: string): AssetFormatRule {
  return ASSET_FORMAT_RULES[normalizeAssetCode(assetCode)] ?? DEFAULT_ASSET_RULE;
}

/**
 * Shorten a Stellar address for display (e.g. GABC...XYZ1)
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Format XLM amount with up to 7 decimal places, trimming trailing zeros.
 * @param amount - The amount to format
 * @param locale - The locale for formatting (defaults to 'en-US')
 */
export function formatXLM(amount: string | number, locale = "en-US"): string {
  return formatAsset(amount, "XLM", locale);
}

/**
 * Format a Stellar asset amount with asset-specific precision rules.
 * @param amount - The amount to format
 * @param assetCode - The asset code (e.g., 'XLM', 'USDC')
 * @param locale - The locale for formatting (defaults to 'en-US')
 */
export function formatAsset(
  amount: string | number,
  assetCode = DEFAULT_ASSET_CODE,
  locale = "en-US"
): string {
  const normalizedAssetCode = normalizeAssetCode(assetCode);
  const rule = getAssetFormatRule(normalizedAssetCode);
  const num = typeof amount === "string" ? parseFloat(amount) : amount;

  if (amount == null || Number.isNaN(num)) {
    const zeroValue =
      rule.minimumFractionDigits > 0 ? (0).toFixed(rule.minimumFractionDigits) : "0";
    return `${zeroValue} ${normalizedAssetCode}`;
  }

  return `${num.toLocaleString(locale, rule)} ${normalizedAssetCode}`;
}

/**
 * Format an asset amount at the asset's full precision, keeping trailing zeros
 * (e.g. "10.0000000 XLM", "15.00 USDC").
 *
 * Use this where the exact ledger value matters — batch totals, receipts,
 * confirmations — and `formatAsset` where a compact display is preferred.
 * @param amount - The amount to format
 * @param assetCode - The asset code (e.g., 'XLM', 'USDC')
 */
export function formatAssetPrecise(
  amount: string | number,
  assetCode = DEFAULT_ASSET_CODE
): string {
  const normalizedAssetCode = normalizeAssetCode(assetCode);
  const rule = getAssetFormatRule(normalizedAssetCode);
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  const safeNum = amount == null || Number.isNaN(num) ? 0 : num;

  return `${safeNum.toFixed(rule.maximumFractionDigits)} ${normalizedAssetCode}`;
}

/**
 * Format an XLM amount at full 7-decimal precision (e.g. "10.0000000 XLM").
 * @param amount - The amount to format
 */
export function formatXLMPrecise(amount: string | number): string {
  return formatAssetPrecise(amount, "XLM");
}

/**
 * Converts a Soroban i128 (stroops) to a human-readable XLM string.
 * @param stroops - The amount in stroops (i128 from Soroban).
 */
export function formatStroopsToXLM(stroops: bigint | string | number): string {
  try {
    if (stroops === null || stroops === undefined) return "0.0000000 XLM";
    const s = typeof stroops === "bigint" ? stroops : BigInt(stroops);
    const xlm = Number(s) / 10_000_000;
    return `${xlm.toFixed(7)} XLM`;
  } catch (err) {
    return "0.0000000 XLM";
  }
}

/**
 * Format a date string as relative time (e.g., "3 minutes ago").
 */
export function timeAgo(dateString: string): string {
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  } catch {
    return dateString;
  }
}

/**
 * Format a date string in a human-readable format.
 */
export function formatDate(dateString: string): string {
  try {
    return format(new Date(dateString), "MMM d, yyyy · HH:mm");
  } catch {
    return dateString;
  }
}

/**
 * Copy text to clipboard and return success boolean.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Preferred path: the async Clipboard API, only available in secure contexts
  // (HTTPS or localhost).
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or transient failure — fall back to execCommand below.
    }
  }

  // Fallback for non-secure (HTTP) contexts where navigator.clipboard is
  // undefined. Returns the real success state so callers don't show a false
  // "Copied!" confirmation.
  if (typeof document !== "undefined" && typeof document.execCommand === "function") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  return false;
}

/**
 * Parse a CSV string into rows and cells.
 * Supports quoted values and escaped quotes.
 */
export function parseCSV(csv: string): string[][] {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  const pushCell = () => {
    currentRow.push(currentCell.trim());
    currentCell = "";
  };

  const pushRow = () => {
    pushCell();
    if (currentRow.length > 1 || currentRow[0] !== "") {
      rows.push(currentRow);
    }
    currentRow = [];
  };

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];

    if (char === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      pushCell();
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      pushRow();
      if (char === "\r" && csv[i + 1] === "\n") {
        i += 1;
      }
      continue;
    }

    currentCell += char;
  }

  if (currentCell !== "" || currentRow.length > 0) {
    pushRow();
  }

  return rows;
}

/**
 * Parse a two-column address book CSV with columns: name, address.
 */
export function parseAddressBookCSV(csv: string) {
  const rows = parseCSV(csv);
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];

  if (header[0] === "name" && header[1] === "address") {
    rows.shift();
  }

  return rows.map((cells, index) => {
    return {
      name: (cells[0] ?? "").trim(),
      address: (cells[1] ?? "").trim(),
      rowNumber: index + 1,
    };
  });
}

export interface BatchRecipientCSVRow {
  /** 1-based line number in the source file, so users can fix the right row. */
  rowNumber: number;
  address: string;
  amount: string;
  memo: string;
  /** Structural problem with the row, or null when the row looks importable. */
  error: string | null;
}

const BATCH_CSV_COLUMNS = ["address", "amount", "memo"] as const;
type BatchCSVColumn = (typeof BATCH_CSV_COLUMNS)[number];

const BATCH_CSV_HEADER_ALIASES: Record<string, BatchCSVColumn> = {
  address: "address",
  recipient: "address",
  "recipient address": "address",
  destination: "address",
  "public key": "address",
  amount: "amount",
  xlm: "amount",
  "amount (xlm)": "amount",
  memo: "memo",
  note: "memo",
};

/**
 * Parse a batch-payment recipient CSV with address, amount and memo columns.
 *
 * A header row is optional; when present its column names (including a few
 * common aliases) decide the column order, otherwise the columns are read
 * positionally as address, amount, memo.
 *
 * Rows are never dropped — a malformed row comes back with an `error` set so
 * the caller can flag it without discarding the valid rows around it.
 */
export function parseBatchRecipientsCSV(csv: string): BatchRecipientCSVRow[] {
  const rows = parseCSV(csv);
  if (rows.length === 0) return [];

  const headerCells = rows[0].map((cell) => cell.trim().toLowerCase());
  const headerMatches = headerCells
    .map((cell) => BATCH_CSV_HEADER_ALIASES[cell])
    .filter((column): column is BatchCSVColumn => Boolean(column));
  const hasHeader = headerMatches.includes("address") && headerMatches.includes("amount");

  const columnIndex: Record<BatchCSVColumn, number> = {
    address: 0,
    amount: 1,
    memo: 2,
  };

  if (hasHeader) {
    BATCH_CSV_COLUMNS.forEach((column) => {
      columnIndex[column] = headerCells.findIndex(
        (cell) => BATCH_CSV_HEADER_ALIASES[cell] === column
      );
    });
  }

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const lineOffset = hasHeader ? 2 : 1;

  return dataRows.map((cells, index) => {
    const cellAt = (column: BatchCSVColumn) => {
      const position = columnIndex[column];
      return position >= 0 ? (cells[position] ?? "").trim() : "";
    };

    const address = cellAt("address");
    const amount = cellAt("amount");
    const memo = cellAt("memo");
    const parsedAmount = parseFloat(amount);

    let error: string | null = null;
    if (!address) {
      error = "Missing recipient address.";
    } else if (!amount) {
      error = "Missing amount.";
    } else if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      error = "Amount must be a number greater than 0.";
    }

    return {
      rowNumber: index + lineOffset,
      address,
      amount,
      memo,
      error,
    };
  });
}

/**
 * Format a USD value with 2 decimal places (e.g. "≈ $142.50 USD").
 * @param usdValue - The USD value to format
 * @param locale - The locale for formatting (defaults to 'en-US')
 */
export function formatUSD(usdValue: number, locale = "en-US"): string {
  return `≈ $${usdValue.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USD`;
}

/**
 * Clamp a string amount between min and max.
 */
export function clampAmount(value: string, min = 0.0000001, max = 999999): number {
  const num = parseFloat(value);
  if (isNaN(num)) return min;
  return Math.max(min, Math.min(max, num));
}

/** Wrap a cell value in quotes and escape any internal quotes. */
function csvCell(value: string | number | undefined | null): string {
  const str = value == null ? "" : String(value);
  // Escape double-quotes by doubling them, then wrap the whole cell
  return `"${str.replace(/"/g, '""')}"`;
}

function triggerDownload(contents: string, filename: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Convert an array of PaymentRecords to a CSV string and trigger a browser
 * file download. No server required — uses a Blob URL.
 *
 * Columns: Date, Type, Amount, Asset, From, To, Memo, Transaction Hash
 */
export function exportToCSV(payments: PaymentRecord[]): void {
  const HEADERS = ["Date", "Type", "Amount", "Asset", "From", "To", "Memo", "Transaction Hash"];

  const rows = payments.map((tx) => [
    csvCell(format(new Date(tx.createdAt), "yyyy-MM-dd HH:mm:ss")),
    csvCell(tx.type === "sent" ? "Sent" : "Received"),
    csvCell(parseFloat(tx.amount).toFixed(7)),
    csvCell(tx.asset ?? "XLM"),
    csvCell(tx.from),
    csvCell(tx.to),
    csvCell(tx.memo ?? ""),
    csvCell(tx.transactionHash),
  ]);

  const csv = [HEADERS.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\r\n");

  const dateStamp = format(new Date(), "yyyy-MM-dd");
  const filename = `stellar-micropay-transactions-${dateStamp}.csv`;
  triggerDownload(csv, filename, "text/csv;charset=utf-8;");
}

interface TipCSVRecord {
  timestamp: string;
  senderPublicKey: string;
  amount: string;
  asset: string;
  memo?: string;
}

/**
 * Convert an array of received tips to a CSV string and trigger a browser
 * file download, for creator bookkeeping (#612).
 *
 * Columns: Date, Sender, Amount, Memo
 */
export function exportTipsToCSV(tips: TipCSVRecord[]): void {
  const HEADERS = ["Date", "Sender", "Amount", "Memo"];

  const rows = tips.map((tip) => [
    csvCell(format(new Date(tip.timestamp), "yyyy-MM-dd HH:mm:ss")),
    csvCell(tip.senderPublicKey),
    csvCell(`${tip.amount} ${tip.asset}`),
    csvCell(tip.memo ?? ""),
  ]);

  const csv = [HEADERS.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\r\n");

  const dateStamp = format(new Date(), "yyyy-MM-dd");
  const filename = `stellar-micropay-tips-${dateStamp}.csv`;
  triggerDownload(csv, filename, "text/csv;charset=utf-8;");
}

/**
 * Convert PaymentRecords to pretty-printed JSON and trigger a browser download.
 */
export function exportToJSON(payments: PaymentRecord[]): void {
  const dateStamp = format(new Date(), "yyyy-MM-dd");
  const filename = `stellar-micropay-transactions-${dateStamp}.json`;
  const json = JSON.stringify(payments, null, 2);
  triggerDownload(json, filename, "application/json;charset=utf-8;");
}
