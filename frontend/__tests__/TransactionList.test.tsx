/**
 * __tests__/TransactionList.test.tsx
 * Accessibility tests for the responsive transaction table (issue #826).
 *
 * The transaction list is an ARIA table: role="table" with a
 * role="columnheader" header row and one role="row" per payment. On narrow
 * viewports the header row is visually hidden but stays in the accessibility
 * tree, and every cell carries a data-label so the column name is still
 * exposed to sighted and assistive-technology users alike.
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import TransactionList from "@/components/TransactionList";
import { TransactionCategory, type PaymentRecord } from "@/lib/stellar";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockGetPaymentHistory = jest.fn();
const mockShortenAddress = jest.fn();
const mockExplorerUrl = jest.fn();
const mockTimeAgo = jest.fn();
const mockFormatAsset = jest.fn();
const mockCopyToClipboard = jest.fn(async () => true);
const mockLoadContacts = jest.fn(() => []);
const mockUpsertContact = jest.fn();
const mockPush = jest.fn();

jest.mock("@/lib/stellar", () => ({
  ...jest.requireActual("@/lib/stellar"),
  getPaymentHistory: (publicKey: string, limit: number, cursor?: string) =>
    mockGetPaymentHistory(publicKey, limit, cursor),
  shortenAddress: (address: string, chars?: number) =>
    mockShortenAddress(address, chars),
  explorerUrl: (hash: string) => mockExplorerUrl(hash),
}));

jest.mock("@/utils/format", () => ({
  formatAsset: (amount: string, asset: string) =>
    mockFormatAsset(amount, asset),
  timeAgo: (dateString: string) => mockTimeAgo(dateString),
  copyToClipboard: (text: string) => mockCopyToClipboard(text),
}));

jest.mock("@/lib/addressBook", () => ({
  loadAddressBookContacts: () => mockLoadContacts(),
  upsertAddressBookContact: (input: { nickname: string; address: string }) =>
    mockUpsertContact(input),
}));

jest.mock("next/router", () => ({
  useRouter: () => ({ push: (path: string) => mockPush(path) }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PUBLIC_KEY = "GALICE1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";

const sentRecord: PaymentRecord = {
  id: "op-sent",
  type: "sent",
  amount: "25",
  asset: "XLM",
  from: PUBLIC_KEY,
  to: "GBOB1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234",
  memo: "Lunch",
  createdAt: "2026-08-28T10:00:00.000Z",
  transactionHash: "tx-sent-hash",
  category: TransactionCategory.Payment,
};

const receivedRecord: PaymentRecord = {
  id: "op-received",
  type: "received",
  amount: "10",
  asset: "USDC",
  from: "GCHARLIE1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1",
  to: PUBLIC_KEY,
  createdAt: "2026-08-28T09:00:00.000Z",
  transactionHash: "tx-received-hash",
  category: TransactionCategory.Transfer,
};

const mergeRecord: PaymentRecord = {
  ...receivedRecord,
  id: "op-merge",
  type: "merge",
  amount: "0",
  memo: undefined,
  transactionHash: "tx-merge-hash",
  category: TransactionCategory.Merge,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockHistory(records: PaymentRecord[]) {
  mockGetPaymentHistory.mockResolvedValue({
    records,
    hasMore: false,
    nextCursor: undefined,
  });
}

async function renderTable(records: PaymentRecord[] = [sentRecord, receivedRecord]) {
  mockHistory(records);
  render(<TransactionList publicKey={PUBLIC_KEY} />);
  const table = await screen.findByRole("table", { name: "Payment history" });
  return table;
}

describe("TransactionList responsive table accessibility (#826)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShortenAddress.mockImplementation((addr: string) => addr.slice(0, 5));
    mockExplorerUrl.mockImplementation(
      (hash: string) => `https://stellar.expert/tx/${hash}`
    );
    mockTimeAgo.mockImplementation(() => "just now");
    mockFormatAsset.mockImplementation(
      (amount: string, asset: string) => `${amount} ${asset}`
    );
  });

  it("renders an ARIA table with all column headers", async () => {
    const table = await renderTable();

    for (const name of [
      "Direction",
      "Counterparty",
      "Date & Memo",
      "Amount",
      "Status",
      "Actions",
    ]) {
      expect(within(table).getByRole("columnheader", { name })).toBeInTheDocument();
    }
  });

  it("exposes direction, amount, memo, and status for every row (desktop layout)", async () => {
    const table = await renderTable();
    const rows = within(table).getAllByRole("row");

    // Header row + one row per payment.
    expect(rows).toHaveLength(3);

    const sentRow = rows[1];
    expect(within(sentRow).getByText("Sent")).toBeInTheDocument();
    expect(within(sentRow).getByText("Sent to")).toBeInTheDocument();
    expect(within(sentRow).getByText("-25 XLM")).toBeInTheDocument();
    expect(within(sentRow).getByText("Completed")).toBeInTheDocument();
    expect(within(sentRow).getByText(/Lunch/)).toBeInTheDocument();

    const receivedRow = rows[2];
    expect(within(receivedRow).getByText("Received")).toBeInTheDocument();
    expect(within(receivedRow).getByText("+10 USDC")).toBeInTheDocument();
    expect(within(receivedRow).getByText("Completed")).toBeInTheDocument();
  });

  it("exposes a distinct status for account-merge records", async () => {
    const table = await renderTable([mergeRecord]);
    const rows = within(table).getAllByRole("row");

    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText("Merged")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Account merged")).toBeInTheDocument();
  });

  it("keeps every cell labelled for narrow layouts via data-label", async () => {
    const table = await renderTable();
    const rows = within(table).getAllByRole("row");
    const expectedLabels = [
      "Direction",
      "Counterparty",
      "Date & Memo",
      "Amount",
      "Status",
      "Actions",
    ];

    for (const row of rows.slice(1)) {
      const cells = within(row).getAllByRole("cell");
      expect(cells).toHaveLength(expectedLabels.length);
      cells.forEach((cell, index) => {
        expect(cell).toHaveAttribute("data-label", expectedLabels[index]);
      });
    }
  });

  it("keeps the header row in the accessibility tree when collapsed", async () => {
    const table = await renderTable();
    const rows = within(table).getAllByRole("row");

    // The header is visually hidden at narrow widths but still exposed to AT.
    expect(rows[0]).toHaveClass("tx-table-header");
    expect(within(rows[0]).getByRole("columnheader", { name: "Amount" })).toBeInTheDocument();
  });
});
