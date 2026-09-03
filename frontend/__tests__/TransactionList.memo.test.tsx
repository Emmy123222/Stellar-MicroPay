import React, { useCallback, useState } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import "@testing-library/jest-dom";
import {
  TransactionRow,
  __resetTransactionRowRenderCount,
  __transactionRowRenderCount,
} from "@/components/TransactionList";
import type { PaymentRecord } from "@/lib/stellar";

jest.mock("@/components/icons", () => ({
  ArrowUpIcon: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-up" className={className} />
  ),
  ArrowDownIcon: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-down" className={className} />
  ),
  ExternalLinkIcon: ({ className }: { className?: string }) => (
    <svg data-testid="external-link" className={className} />
  ),
  HistoryIcon: () => <svg />,
  RefreshIcon: () => <svg />,
}));

const payment: PaymentRecord = {
  id: "op-1",
  type: "sent",
  amount: "10.0000000",
  asset: "XLM",
  from: "G".padEnd(56, "A"),
  to: "G".padEnd(56, "B"),
  createdAt: "2026-01-15T12:00:00Z",
  transactionHash: "abc123",
};

function ParentWithToast({ payment: tx }: { payment: PaymentRecord }) {
  const [toast, setToast] = useState<string | null>(null);
  const onCopy = useCallback(() => {}, []);
  const onSaveContact = useCallback(() => {}, []);
  const onSendAgain = useCallback(() => {}, []);
  const onFocusRow = useCallback(() => {}, []);
  const onBlurRow = useCallback(() => {}, []);
  const onNavigate = useCallback(() => {}, []);

  return (
    <div>
      <button type="button" onClick={() => setToast("Payment sent!")}>
        Show toast
      </button>
      {toast && <div role="status">{toast}</div>}
      <TransactionRow
        tx={tx}
        index={0}
        isFocused={false}
        isCopied={false}
        onCopy={onCopy}
        onSaveContact={onSaveContact}
        onSendAgain={onSendAgain}
        onFocusRow={onFocusRow}
        onBlurRow={onBlurRow}
        onNavigate={onNavigate}
      />
    </div>
  );
}

describe("TransactionRow memoization (#605)", () => {
  beforeEach(() => {
    __resetTransactionRowRenderCount();
  });

  it("is wrapped in React.memo", () => {
    expect((TransactionRow as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for("react.memo")
    );
  });

  it("does not re-render rows when unrelated parent state changes (e.g. toast)", async () => {
    const user = userEvent.setup();
    render(<ParentWithToast payment={payment} />);

    expect(screen.getByRole("row")).toBeInTheDocument();
    expect(__transactionRowRenderCount).toBe(1);

    await user.click(screen.getByRole("button", { name: "Show toast" }));
    expect(screen.getByRole("status")).toHaveTextContent("Payment sent!");
    expect(__transactionRowRenderCount).toBe(1);
  });

  it("re-renders when row-relevant props change", () => {
    const props = {
      tx: payment,
      index: 0,
      isFocused: false,
      isCopied: false,
      onCopy: jest.fn(),
      onSaveContact: jest.fn(),
      onSendAgain: jest.fn(),
      onFocusRow: jest.fn(),
      onBlurRow: jest.fn(),
      onNavigate: jest.fn(),
    };

    const { rerender } = render(<TransactionRow {...props} />);
    expect(__transactionRowRenderCount).toBe(1);

    rerender(<TransactionRow {...props} isFocused />);
    expect(__transactionRowRenderCount).toBe(2);
  });
});
