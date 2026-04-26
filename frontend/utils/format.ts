/**
 * utils/format.ts
 * Shared formatting utilities.
 */

import { PaymentRecord } from "@/lib/stellar";
import { formatDistanceToNow, format } from "date-fns";

/**
 * Format XLM amount with up to 7 decimal places, trimming trailing zeros.
 */
export function formatXLM(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "0 XLM";
  return `${num.toLocaleString("en-US", { maximumFractionDigits: 7 })} XLM`;
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

/**
 * Format a USD value with 2 decimal places (e.g. "≈ $142.50 USD").
 */
export function formatUSD(usdValue: number): string {
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
 * Columns: Date, Type, Amount, Asset, From, To, Memo, Transaction Hash
 */
export function exportToCSV(payments: PaymentRecord[]): void {
  const HEADERS = [
    "Date",
    "Type",
    "Amount",
    "Asset",
    "From",
    "To",
    "Memo",
    "Transaction Hash",
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
