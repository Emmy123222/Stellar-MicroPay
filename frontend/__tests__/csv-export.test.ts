/**
 * __tests__/csv-export.test.ts
 * Issue #1046 — Export CSV of the currently filtered/loaded transactions.
 * Covers the CSV builder (columns, counterparty side, filename).
 */

import {
  buildTransactionsCsvFilename,
  exportFilteredTransactionsToCSV,
} from "@/utils/format";
import type { PaymentRecord } from "@/lib/stellar";

const KEY = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZAAAA";
const OTHER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function makePayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "tx-1",
    type: "sent",
    amount: "12.5",
    asset: "XLM",
    from: KEY,
    to: OTHER,
    memo: "coffee",
    transactionHash: "hash-123",
    createdAt: new Date("2026-09-26T10:00:00Z").toISOString(),
    ...overrides,
  } as PaymentRecord;
}

let csvBodies: string[];
let downloads: string[];
let FakeBlob: new (parts: string[]) => { parts: string[] };
let originalBlob: unknown;
let createdUrls: string[];

beforeEach(() => {
  csvBodies = [];
  downloads = [];
  createdUrls = [];
  originalBlob = global.Blob;
  FakeBlob = class {
    parts: string[];
    constructor(parts: string[]) {
      this.parts = parts;
      csvBodies.push(parts[0]);
    }
  } as unknown as new (parts: string[]) => { parts: string[] };
  (global as { Blob: unknown }).Blob = FakeBlob;

  Object.defineProperty(window.URL, "createObjectURL", {
    value: jest.fn(() => {
      const url = `blob:test-${createdUrls.length}`;
      createdUrls.push(url);
      return url;
    }),
    configurable: true,
  });
  Object.defineProperty(window.URL, "revokeObjectURL", {
    value: jest.fn(),
    configurable: true,
  });

  const originalAppend = document.body.appendChild.bind(document.body);
  jest.spyOn(document.body, "appendChild").mockImplementation(((node: Node) => {
    if (node instanceof HTMLAnchorElement) {
      downloads.push(node.download);
      node.click = jest.fn();
    }
    return originalAppend(node);
  }) as typeof document.body.appendChild);
});

afterEach(() => {
  (global as { Blob: unknown }).Blob = originalBlob;
  jest.restoreAllMocks();
});

describe("buildTransactionsCsvFilename (#1046)", () => {
  it("uses stellar-transactions-<short-key>-<date>.csv", () => {
    expect(
      buildTransactionsCsvFilename(KEY, new Date("2026-09-26T00:00:00Z"))
    ).toBe("stellar-transactions-GBRP-2026-09-26.csv");
  });

  it("falls back to a generic short key for empty input", () => {
    expect(
      buildTransactionsCsvFilename("", new Date("2026-09-26T00:00:00Z"))
    ).toBe("stellar-transactions-acco-2026-09-26.csv");
  });
});

describe("exportFilteredTransactionsToCSV (#1046)", () => {
  it("emits the required header row and filename", () => {
    exportFilteredTransactionsToCSV([makePayment()], KEY);

    const csv = csvBodies[0];
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      '"Date","Type","Amount","Asset","Counterparty","Memo","Tx Hash"'
    );
    expect(downloads[0]).toMatch(
      /^stellar-transactions-GBRP-\d{4}-\d{2}-\d{2}\.csv$/
    );
  });

  it("writes the counterparty as recipient (to) for sent rows", () => {
    exportFilteredTransactionsToCSV([makePayment()], KEY);

    const dataLine = csvBodies[0].split("\r\n")[1];
    expect(dataLine).toContain('"sent"');
    expect(dataLine).toContain(`"${OTHER}"`);
    expect(dataLine).toContain('"coffee"');
    expect(dataLine).toContain('"hash-123"');
  });

  it("writes the counterparty as sender (from) for received rows", () => {
    const received = makePayment({
      id: "tx-2",
      type: "received",
      from: OTHER,
      to: KEY,
      memo: undefined,
      amount: "3",
    });
    exportFilteredTransactionsToCSV([received], KEY);

    const dataLine = csvBodies[0].split("\r\n")[1];
    expect(dataLine).toContain('"received"');
    expect(dataLine).toContain(`"${OTHER}"`);
    expect(dataLine).toContain('""'); // empty memo cell
  });

  it("escapes embedded quotes in memo fields", () => {
    exportFilteredTransactionsToCSV(
      [makePayment({ memo: 'say "hi"' })],
      KEY
    );

    const dataLine = csvBodies[0].split("\r\n")[1];
    expect(dataLine).toContain('"say ""hi"""');
  });
});
