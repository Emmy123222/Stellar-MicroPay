/**
 * utils/format.ts
 * Shared formatting utilities.
 * 
 * MIGRATION NOTE: This file now uses Intl-based formatters from intlFormatters.ts
 * for better internationalization support. The API remains backward compatible.
 */

import { PaymentRecord } from "@/lib/stellar";
import { format, formatDistanceToNow } from "date-fns";
import {
  formatStroopsToXLM as formatStroopsToXLMIntl,
  getUserLocale,
} from "./intlFormatters";

// Re-export from intlFormatters for better tree-shaking
export {
  formatNumber,
  formatSmallAmount,
  formatForScreenReader,
  validateDate,
  validateAmount,
  getUserTimezone,
  pluralize as pluralizeIntl, // Rename to avoid conflicts
  formatDateFull,
} from "./intlFormatters";

/**
 * Shorten a Stellar address for display (e.g. GABC...XYZ1)
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length <= chars * 2 + 2) {
    return address;
  }
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Format XLM amount with up to 7 decimal places, trimming trailing zeros.
 */
export function formatXLM(amount: string | number): string {
  return formatAsset(amount, "XLM");
}

/**
 * Format XLM amount with precise decimal display (no trailing zeros).
 */
export function formatXLMPrecise(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(num)) return "0 XLM";
  return `${num.toFixed(7).replace(/\.?0+$/, "")} XLM`;
}

/**
 * Format a Stellar asset amount with asset-specific precision rules.
 */
const DEFAULT_ASSET_CODE = "XLM";

const ASSET_FORMAT_RULES: Record<
  string,
  { minimumFractionDigits: number; maximumFractionDigits: number }
> = {
  XLM: { minimumFractionDigits: 0, maximumFractionDigits: 7 },
  USDC: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  AQUA: { minimumFractionDigits: 0, maximumFractionDigits: 7 },
  DEFAULT: { minimumFractionDigits: 0, maximumFractionDigits: 7 },
};

function normalizeAssetCode(assetCode?: string): string {
  return assetCode?.trim().toUpperCase() || DEFAULT_ASSET_CODE;
}

function getAssetFormatRule(assetCode?: string): {
  minimumFractionDigits: number;
  maximumFractionDigits: number;
} {
  const normalized = normalizeAssetCode(assetCode);
  return ASSET_FORMAT_RULES[normalized] ?? ASSET_FORMAT_RULES.DEFAULT;
}

export function formatAsset(
  amount: string | number,
  assetCode = "XLM"
): string {
  return formatAssetIntl(amount, assetCode);
}

/**
 * Converts a Soroban i128 (stroops) to a human-readable XLM string.
 * @param stroops - The amount in stroops (i128 from Soroban).
 */
export function formatStroopsToXLM(stroops: bigint | string | number): string {
  return formatStroopsToXLMIntl(stroops, { locale: getUserLocale() });
}

/**
 * Format a date string as relative time (e.g., "3 minutes ago").
 */
export function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Format a date string in a human-readable format.
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return format(date, "MMM d, yyyy · HH:mm");
}


/**
 * Copy text to clipboard and return success boolean.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
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

    if (!inQuotes && char === ',') {
      pushCell();
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      pushRow();
      if (char === '\r' && csv[i + 1] === '\n') {
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
  rowNumber: number;
  address: string;
  amount: string;
  asset?: string;
  memo: string;
  error: string | null;
}

/**
 * Parse a batch recipients CSV with columns: address, amount, asset (optional), memo (optional).
 * Supports both header row and positional columns.
 * Returns all rows, including those with errors, so the caller can flag them without losing data.
 * the caller can flag it without discarding the valid rows around it.
 */
export function parseBatchRecipientsCSV(csv: string): BatchRecipientCSVRow[] {
  const rows = parseCSV(csv);
  if (rows.length === 0) return [];

  // Check if first row looks like a header
  const firstRow = rows[0].map((cell) => cell.trim().toLowerCase());
  const hasHeader =
    firstRow.includes("address") ||
    firstRow.includes("recipient") ||
    firstRow.includes("amount");

  let dataRows = rows;
  let headerMap: Record<string, number> = {};

  if (hasHeader) {
    dataRows = rows.slice(1);
    // Build a map of column name to index
    firstRow.forEach((name, index) => {
      if (name === "recipient") {
        headerMap["address"] = index;
      } else if (["address", "amount", "asset", "memo"].includes(name)) {
        headerMap[name] = index;
      }
    });
  }

  return dataRows.map((cells, index) => {
    const rowNumber = index + 1;

    // Extract values based on header or position
    let address: string;
    let amount: string;
    let asset: string | undefined;
    let memo: string;

    if (hasHeader && Object.keys(headerMap).length > 0) {
      address = (cells[headerMap["address"]] ?? "").trim();
      amount = (cells[headerMap["amount"]] ?? "").trim();
      asset = headerMap["asset"] !== undefined ? (cells[headerMap["asset"]] ?? "").trim() : undefined;
      memo = (cells[headerMap["memo"]] ?? "").trim();
    } else {
      // Positional: address, amount, asset (optional), memo (optional)
      address = (cells[0] ?? "").trim();
      amount = (cells[1] ?? "").trim();
      asset = cells[2] ? cells[2].trim() : undefined;
      memo = (cells[3] ?? "").trim();
    }

    // Validate and flag errors
    let error: string | null = null;

    if (!address) {
      error = "Missing address.";
    }

    if (!amount) {
      if (!error) error = "Missing amount.";
    } else {
      const parsedAmount = parseFloat(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        error = "Amount must be a positive number.";
      }
    }

    // Asset validation (optional - only XLM supported for now per BatchPaymentForm)
    if (asset && asset.toUpperCase() !== "XLM" && asset !== "") {
      if (!error) error = "Only XLM asset is currently supported.";
    }

    return {
      rowNumber,
      address,
      amount,
      asset: asset && asset !== "" ? asset.toUpperCase() : undefined,
      memo,
      error,
    };
  });
}

/**
 * Format a USD value with 2 decimal places (e.g. "≈ $142.50 USD").
 * @param usdValue - The USD value to format
 * @param locale - The locale for formatting (defaults to user's locale)
 */
export function formatUSD(usdValue: number, locale?: string): string {
  void locale;
  if (usdValue == null) return `≈ $0.00 USD`;
  if (isNaN(usdValue)) return `≈ $NaN USD`;
  return `≈ $${usdValue.toLocaleString("en-US", {
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
 * Columns: Date, Type, Amount, Asset, From, To, Memo, Transaction Hash, Private Note
 *
 * @param payments - Array of payment records to export.
 * @param notes - Optional map of transactionHash → private note (Issue #1189).
 */
export function exportToCSV(
  payments: PaymentRecord[],
  notes?: Record<string, string>
): void {
  const HEADERS = [
    "Date",
    "Type",
    "Amount",
    "Asset",
    "From",
    "To",
    "Memo",
    "Transaction Hash",
    "Private Note",
  ];

  const rows = payments.map((tx) => [
    csvCell(format(new Date(tx.createdAt), "yyyy-MM-dd HH:mm:ss")),
    csvCell(tx.type === "sent" ? "Sent" : "Received"),
    csvCell(parseFloat(tx.amount).toFixed(7)),
    csvCell(tx.asset ?? "XLM"),
    csvCell(tx.from),
    csvCell(tx.to),
    csvCell(tx.memo ?? ""),
    csvCell(tx.transactionHash),
    csvCell(notes?.[tx.transactionHash] ?? ""),
  ]);

  const csv = [
    HEADERS.map(csvCell).join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\r\n");

  const dateStamp = format(new Date(), "yyyy-MM-dd");
  const filename = `stellar-micropay-transactions-${dateStamp}.csv`;
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

/**
 * Export the currently filtered and loaded transactions as CSV (Issue #1046).
 *
 * Unlike the page-level full-history export, this exports exactly the rows
 * the user sees — the filtered set of loaded records — so accounting exports
 * match what is on screen.
 *
 * Columns: date, type (sent/received), amount, asset, counterparty, memo,
 * tx_hash. Filename: `stellar-transactions-<publicKey-short>-<date>.csv`.
 */
export function exportFilteredTransactionsToCSV(
  payments: PaymentRecord[],
  publicKey: string
): void {
  const HEADERS = [
    "Date",
    "Type",
    "Amount",
    "Asset",
    "Counterparty",
    "Memo",
    "Tx Hash",
  ];

  const rows = payments.map((tx) => [
    csvCell(format(new Date(tx.createdAt), "yyyy-MM-dd HH:mm:ss")),
    csvCell(tx.type === "sent" ? "sent" : "received"),
    csvCell(parseFloat(tx.amount).toFixed(7)),
    csvCell(tx.asset ?? "XLM"),
    // The counterparty is the other side of the payment relative to the
    // exporting account.
    csvCell(tx.type === "sent" ? tx.to : tx.from),
    csvCell(tx.memo ?? ""),
    csvCell(tx.transactionHash),
  ]);

  const csv = [
    HEADERS.map(csvCell).join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\r\n");

  triggerDownload(csv, buildTransactionsCsvFilename(publicKey), "text/csv;charset=utf-8;");
}

/**
 * Builds the issue-#1046 filename:
 * `stellar-transactions-<publicKey-short>-<date>.csv` where
 * `<publicKey-short>` is the first 4 characters of the account's public key.
 * `now` is injectable so tests can assert the date stamp deterministically.
 */
export function buildTransactionsCsvFilename(publicKey: string, now: Date = new Date()): string {
  const shortKey = (publicKey || "account").slice(0, 4).replace(/[^a-zA-Z0-9]/g, "");
  const dateStamp = format(now, "yyyy-MM-dd");
  return `stellar-transactions-${shortKey}-${dateStamp}.csv`;
}
