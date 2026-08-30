import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import BatchPaymentForm from "@/components/BatchPaymentForm";
import {
  TEST_PUBLIC_KEY_A,
  TEST_PUBLIC_KEY_B,
  TEST_PUBLIC_KEY_C,
} from "./fixtures/stellar";

const mockSubmitTransaction = jest.fn(() => Promise.resolve({ hash: "tx-abc123" }));

jest.mock("@/lib/stellar", () => ({
  isValidStellarAddress: jest.fn(
    (addr: string) => typeof addr === "string" && addr.startsWith("G") && addr.length === 56
  ),
  buildPaymentTransaction: jest.fn(() =>
    Promise.resolve({ toXDR: () => "mocked-xdr" })
  ),
  submitTransaction: (...args: unknown[]) => mockSubmitTransaction(...args),
  STELLAR_MEMO_TEXT_MAX_BYTES: 28,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM: 1,
  truncateMemoText: jest.fn((text: string) => text),
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(() =>
    Promise.resolve({ signedXDR: "signed-xdr", error: null })
  ),
}));

const OWN_KEY = TEST_PUBLIC_KEY_A;
const VALID_ADDR = TEST_PUBLIC_KEY_B;
const SECOND_ADDR = TEST_PUBLIC_KEY_C;

const defaultProps = {
  publicKey: OWN_KEY,
  xlmBalance: "100",
  onBatchSuccess: jest.fn(),
};

describe("BatchPaymentForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders with a single empty recipient row by default", () => {
    render(<BatchPaymentForm {...defaultProps} />);

    expect(screen.getAllByPlaceholderText("G...")).toHaveLength(1);
    expect(screen.getByText("1 / 10")).toBeInTheDocument();
  });

  it("adds a new recipient row when Add recipient is clicked", async () => {
    const user = userEvent.setup();
    render(<BatchPaymentForm {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: /Add recipient/i }));

    expect(screen.getAllByPlaceholderText("G...")).toHaveLength(2);
    expect(screen.getByText("2 / 10")).toBeInTheDocument();
  });

  it("removes a recipient row when Remove is clicked", async () => {
    const user = userEvent.setup();
    render(<BatchPaymentForm {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: /Add recipient/i }));
    expect(screen.getAllByPlaceholderText("G...")).toHaveLength(2);

    const removeButtons = screen.getAllByRole("button", { name: /Remove/i });
    await user.click(removeButtons[0]);

    expect(screen.getAllByPlaceholderText("G...")).toHaveLength(1);
    expect(screen.getByText("1 / 10")).toBeInTheDocument();
  });

  it("Send batch button is disabled when no row has a valid address and amount", () => {
    render(<BatchPaymentForm {...defaultProps} />);
    expect(screen.getByRole("button", { name: /Send batch/i })).toBeDisabled();
  });

  it("Send batch button is enabled once a row has a valid address and positive amount", async () => {
    const user = userEvent.setup();
    render(<BatchPaymentForm {...defaultProps} />);

    await user.type(screen.getByPlaceholderText("G..."), VALID_ADDR);
    await user.type(screen.getByPlaceholderText("0.5"), "2");

    expect(screen.getByRole("button", { name: /Send batch/i })).not.toBeDisabled();
  });

  it("computes the total amount correctly across multiple rows", async () => {
    const user = userEvent.setup();
    render(<BatchPaymentForm {...defaultProps} />);

    await user.type(screen.getAllByPlaceholderText("0.5")[0], "2.5");
    await user.click(screen.getByRole("button", { name: /Add recipient/i }));
    await user.type(screen.getAllByPlaceholderText("0.5")[1], "7.5");

    expect(screen.getByText(/10\.0000000 XLM/)).toBeInTheDocument();
  });

  it("shows inline validation error for an invalid Stellar address after batch submit", async () => {
    const user = userEvent.setup();
    render(<BatchPaymentForm {...defaultProps} />);

    // Add a second valid row so the button is enabled
    await user.click(screen.getByRole("button", { name: /Add recipient/i }));
    const addressInputs = screen.getAllByPlaceholderText("G...");
    const amountInputs = screen.getAllByPlaceholderText("0.5");

    await user.type(addressInputs[1], VALID_ADDR);
    await user.type(amountInputs[1], "1");

    // First row intentionally left with bad address
    await user.type(addressInputs[0], "INVALID_ADDRESS");
    await user.type(amountInputs[0], "1");

    await user.click(screen.getByRole("button", { name: /Send batch/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Invalid Stellar address/i).length).toBeGreaterThan(0);
    });
  });

  it("shows inline validation error when amount is zero or missing", async () => {
    const user = userEvent.setup();
    render(<BatchPaymentForm {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: /Add recipient/i }));
    const addressInputs = screen.getAllByPlaceholderText("G...");
    const amountInputs = screen.getAllByPlaceholderText("0.5");

    // Second row is valid; enables submit
    await user.type(addressInputs[1], VALID_ADDR);
    await user.type(amountInputs[1], "1");

    // First row has valid address but no amount
    await user.type(addressInputs[0], VALID_ADDR);

    await user.click(screen.getByRole("button", { name: /Send batch/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Amount must be greater than 0/i).length).toBeGreaterThan(0);
    });
  });

  // ── Row and Column Error Reporting (#744) ───────────────────────────────────

  describe("per-row and column error reporting (#744)", () => {
    it("associates errors with row number and source column", async () => {
      const user = userEvent.setup();
      render(<BatchPaymentForm {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: /Add recipient/i }));
      const addressInputs = screen.getAllByPlaceholderText("G...");
      const amountInputs = screen.getAllByPlaceholderText("0.5");

      // Row 1: invalid address, valid amount
      await user.type(addressInputs[0], "BAD_ADDR");
      await user.type(amountInputs[0], "5");

      // Row 2: valid address and amount to enable submission
      await user.type(addressInputs[1], VALID_ADDR);
      await user.type(amountInputs[1], "2");

      await user.click(screen.getByRole("button", { name: /Send batch/i }));

      await waitFor(() => {
        expect(screen.getByTestId("row-1-address-error")).toHaveTextContent(
          "Row 1 (Address): Invalid Stellar address."
        );
      });
    });

    it("supports filtering to invalid rows and back (#744)", async () => {
      const user = userEvent.setup();
      render(<BatchPaymentForm {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: /Add recipient/i }));
      const addressInputs = screen.getAllByPlaceholderText("G...");
      const amountInputs = screen.getAllByPlaceholderText("0.5");

      // Row 1 is invalid
      await user.type(addressInputs[0], "BAD_ADDR");
      await user.type(amountInputs[0], "1");

      // Row 2 is valid
      await user.type(addressInputs[1], VALID_ADDR);
      await user.type(amountInputs[1], "2");

      await user.click(screen.getByRole("button", { name: /Send batch/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Filter to invalid rows/i })).toBeInTheDocument();
      });

      // Filter to invalid rows only
      await user.click(screen.getByRole("button", { name: /Filter to invalid rows/i }));

      expect(screen.getByTestId("recipient-row-1")).toBeInTheDocument();
      expect(screen.queryByTestId("recipient-row-2")).not.toBeInTheDocument();

      // Switch back to all rows
      await user.click(screen.getByRole("button", { name: /^All \(/i }));
      expect(screen.getByTestId("recipient-row-1")).toBeInTheDocument();
      expect(screen.getByTestId("recipient-row-2")).toBeInTheDocument();
    });

    it("keeps valid edits intact after revalidation (#744)", async () => {
      const user = userEvent.setup();
      render(<BatchPaymentForm {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: /Add recipient/i }));
      const addressInputs = screen.getAllByPlaceholderText("G...");
      const amountInputs = screen.getAllByPlaceholderText("0.5");

      // Row 1: valid address and amount
      await user.type(addressInputs[0], VALID_ADDR);
      await user.type(amountInputs[0], "10");

      // Row 2: invalid address
      await user.type(addressInputs[1], "INVALID_ADDRESS");
      await user.type(amountInputs[1], "5");

      // Now edit Row 2 with a valid address
      await user.clear(screen.getAllByPlaceholderText("G...")[1]);
      await user.type(screen.getAllByPlaceholderText("G...")[1], SECOND_ADDR);

      // Verify Row 1 data was preserved intact
      expect(screen.getAllByPlaceholderText("G...")[0]).toHaveValue(VALID_ADDR);
      expect(screen.getAllByPlaceholderText("0.5")[0]).toHaveValue(10);
      expect(screen.getAllByPlaceholderText("G...")[1]).toHaveValue(SECOND_ADDR);
      expect(screen.getAllByPlaceholderText("0.5")[1]).toHaveValue(5);
    });
  });

  // ── CSV import (#616, #744) ────────────────────────────────────────────────

  describe("CSV import", () => {
    function csvFile(contents: string, name = "recipients.csv") {
      return new File([contents], name, { type: "text/csv" });
    }

    function getImportInput() {
      return screen.getByLabelText(/Import recipients from CSV/i) as HTMLInputElement;
    }

    it("populates recipient rows from address, amount and memo columns", async () => {
      const user = userEvent.setup();
      render(<BatchPaymentForm {...defaultProps} />);

      await user.upload(
        getImportInput(),
        csvFile(
          `address,amount,memo\n${VALID_ADDR},2.5,Rent\n${SECOND_ADDR},7.5,Salary\n`
        )
      );

      await waitFor(() => {
        expect(screen.getAllByPlaceholderText("G...")).toHaveLength(2);
      });

      const addressInputs = screen.getAllByPlaceholderText("G...");
      expect(addressInputs[0]).toHaveValue(VALID_ADDR);
      expect(addressInputs[1]).toHaveValue(SECOND_ADDR);

      const amountInputs = screen.getAllByPlaceholderText("0.5");
      expect(amountInputs[0]).toHaveValue(2.5);
      expect(amountInputs[1]).toHaveValue(7.5);

      const memoInputs = screen.getAllByPlaceholderText("Payment note");
      expect(memoInputs[0]).toHaveValue("Rent");
      expect(memoInputs[1]).toHaveValue("Salary");

      expect(screen.getByText(/10\.0000000 XLM/)).toBeInTheDocument();
      expect(screen.getByText(/Imported 2 recipients/i)).toBeInTheDocument();
    });

    it("imports headerless CSV files positionally", async () => {
      const user = userEvent.setup();
      render(<BatchPaymentForm {...defaultProps} />);

      await user.upload(getImportInput(), csvFile(`${VALID_ADDR},1.25,Coffee\n`));

      await waitFor(() => {
        expect(screen.getByPlaceholderText("G...")).toHaveValue(VALID_ADDR);
      });
      expect(screen.getByPlaceholderText("0.5")).toHaveValue(1.25);
    });

    it("flags malformed rows without discarding the valid ones", async () => {
      const user = userEvent.setup();
      render(<BatchPaymentForm {...defaultProps} />);

      await user.upload(
        getImportInput(),
        csvFile(
          `address,amount,memo\n${VALID_ADDR},2,Good row\nNOT_AN_ADDRESS,1,Bad address\n${SECOND_ADDR},abc,Bad amount\n`
        )
      );

      await waitFor(() => {
        expect(screen.getAllByPlaceholderText("G...")).toHaveLength(3);
      });

      expect(screen.getAllByText(/Invalid Stellar address/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Amount must be a number greater than 0/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/2 rows need attention/i)).toBeInTheDocument();

      // The single valid row is still importable and enables submission
      expect(screen.getByRole("button", { name: /Send batch/i })).not.toBeDisabled();
    });

    it("flags a row that pays the connected wallet itself", async () => {
      const user = userEvent.setup();
      render(<BatchPaymentForm {...defaultProps} />);

      await user.upload(getImportInput(), csvFile(`${OWN_KEY},1,Self\n`));

      await waitFor(() => {
        expect(
          screen.getAllByText(/Recipient address cannot be the same as your wallet/i).length
        ).toBeGreaterThan(0);
      });
    });

    it("keeps at most the maximum number of recipients and says so", async () => {
      const user = userEvent.setup();
      render(<BatchPaymentForm {...defaultProps} />);

      const rows = Array.from({ length: 12 }, () => `${VALID_ADDR},1,`).join("\n");
      await user.upload(getImportInput(), csvFile(rows));

      await waitFor(() => {
        expect(screen.getAllByPlaceholderText("G...")).toHaveLength(10);
      });
      expect(screen.getByText(/2 extra rows skipped/i)).toBeInTheDocument();
    });

    it("reports an empty CSV instead of clearing the form", async () => {
      const user = userEvent.setup();
      render(<BatchPaymentForm {...defaultProps} />);

      await user.upload(getImportInput(), csvFile("\n"));

      await waitFor(() => {
        expect(screen.getByText(/No recipients found in that CSV file/i)).toBeInTheDocument();
      });
      expect(screen.getAllByPlaceholderText("G...")).toHaveLength(1);
    });
  });

  it("warns when total XLM exceeds available balance", async () => {
    const user = userEvent.setup();
    render(<BatchPaymentForm {...defaultProps} xlmBalance="5" />);

    await user.type(screen.getByPlaceholderText("G..."), VALID_ADDR);
    await user.type(screen.getByPlaceholderText("0.5"), "10");

    expect(
      screen.getByText(/Total exceeds your available XLM balance/i)
    ).toBeInTheDocument();
  });
});
