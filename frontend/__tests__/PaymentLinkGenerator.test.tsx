import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import PaymentLinkGenerator from "@/components/PaymentLinkGenerator";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockBuildPaymentLinkUrl = jest.fn();
const mockRememberPaymentLink = jest.fn();
const mockListPaymentLinks = jest.fn(() => []);

jest.mock("@/lib/paymentLinks", () => ({
  buildPaymentLinkUrl: (...args: unknown[]) => mockBuildPaymentLinkUrl(...args),
  rememberPaymentLink: (...args: unknown[]) => mockRememberPaymentLink(...args),
  listPaymentLinks: () => mockListPaymentLinks(),
}));

// qrcode.react renders nothing in jsdom — stub it to avoid canvas errors
jest.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-testid="qr-code" data-value={value} />,
}));

// ─── clipboard ────────────────────────────────────────────────────────────────

const writeTextMock = jest.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: writeTextMock },
  writable: true,
  configurable: true,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_DESTINATION = "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
const FAKE_URL = "https://example.com/pay?to=GABC&amount=10";

function fillForm(user: ReturnType<typeof userEvent.setup>, opts: { destination?: string; amount?: string; memo?: string } = {}) {
  const destination = opts.destination ?? VALID_DESTINATION;
  const amount = opts.amount ?? "10";
  return async () => {
    await user.type(screen.getByPlaceholderText("G..."), destination);
    await user.clear(screen.getByPlaceholderText("1.0"));
    await user.type(screen.getByPlaceholderText("1.0"), amount);
    if (opts.memo) {
      await user.type(screen.getByPlaceholderText("ID: 123"), opts.memo);
    }
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PaymentLinkGenerator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildPaymentLinkUrl.mockReturnValue(FAKE_URL);
    mockListPaymentLinks.mockReturnValue([]);
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  it("renders the form fields", () => {
    render(<PaymentLinkGenerator />);
    expect(screen.getByPlaceholderText("G...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("1.0")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ID: 123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create payment link/i })).toBeInTheDocument();
  });

  it("disables the generate button when destination or amount is empty", () => {
    render(<PaymentLinkGenerator />);
    expect(screen.getByRole("button", { name: /create payment link/i })).toBeDisabled();
  });

  // ── Link generation ────────────────────────────────────────────────────────

  it("generates a link containing the entered amount and destination", async () => {
    const user = userEvent.setup();
    render(<PaymentLinkGenerator />);

    await fillForm(user)();
    await user.click(screen.getByRole("button", { name: /create payment link/i }));

    expect(mockBuildPaymentLinkUrl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ amount: "10", destination: VALID_DESTINATION })
    );

    expect(screen.getByDisplayValue(FAKE_URL)).toBeInTheDocument();
  });

  it("includes memo in the link payload when provided", async () => {
    const user = userEvent.setup();
    render(<PaymentLinkGenerator />);

    await fillForm(user, { memo: "coffee" })();
    await user.click(screen.getByRole("button", { name: /create payment link/i }));

    expect(mockBuildPaymentLinkUrl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ memo: "coffee" })
    );
  });

  it("does not generate a link when destination is empty", async () => {
    const user = userEvent.setup();
    render(<PaymentLinkGenerator />);

    // Only type an amount, no destination
    await user.clear(screen.getByPlaceholderText("1.0"));
    await user.type(screen.getByPlaceholderText("1.0"), "5");

    expect(screen.getByRole("button", { name: /create payment link/i })).toBeDisabled();
    expect(mockBuildPaymentLinkUrl).not.toHaveBeenCalled();
  });

  // ── Expiry encoding ────────────────────────────────────────────────────────

  it("passes validUntil=null when expiry is set to 'never'", async () => {
    const user = userEvent.setup();
    render(<PaymentLinkGenerator />);

    // "Never Expire" is the default selection
    await fillForm(user)();
    await user.click(screen.getByRole("button", { name: /create payment link/i }));

    expect(mockBuildPaymentLinkUrl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ validUntil: null })
    );
  });

  it("passes a future validUntil timestamp when '24 Hours' expiry is selected", async () => {
    const user = userEvent.setup();
    const before = Date.now();
    render(<PaymentLinkGenerator />);

    await fillForm(user)();
    await user.selectOptions(screen.getByRole("combobox"), "24 Hours");
    await user.click(screen.getByRole("button", { name: /create payment link/i }));

    const callPayload = mockBuildPaymentLinkUrl.mock.calls[0][1];
    expect(callPayload.validUntil).toBeGreaterThan(before);
    // Should be approximately 24 h from now (within a 5-second tolerance)
    expect(callPayload.validUntil).toBeCloseTo(before + 24 * 60 * 60 * 1000, -4);
  });

  it("passes a 7-day validUntil timestamp when '7 Days' expiry is selected", async () => {
    const user = userEvent.setup();
    const before = Date.now();
    render(<PaymentLinkGenerator />);

    await fillForm(user)();
    await user.selectOptions(screen.getByRole("combobox"), "7 Days");
    await user.click(screen.getByRole("button", { name: /create payment link/i }));

    const callPayload = mockBuildPaymentLinkUrl.mock.calls[0][1];
    expect(callPayload.validUntil).toBeGreaterThan(before);
    expect(callPayload.validUntil).toBeCloseTo(before + 7 * 24 * 60 * 60 * 1000, -4);
  });

  // ── Clipboard ─────────────────────────────────────────────────────────────

  it("copies the generated link to clipboard when Copy is clicked", async () => {
    const user = userEvent.setup();
    render(<PaymentLinkGenerator />);

    await fillForm(user)();
    await user.click(screen.getByRole("button", { name: /create payment link/i }));
    await user.click(screen.getByRole("button", { name: /copy/i }));

    expect(writeTextMock).toHaveBeenCalledWith(FAKE_URL);
  });

  it("shows 'Copied!' feedback after clicking copy", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ delay: null });
    render(<PaymentLinkGenerator />);

    await fillForm(user)();
    await user.click(screen.getByRole("button", { name: /create payment link/i }));
    await user.click(screen.getByRole("button", { name: /copy/i }));

    expect(screen.getByRole("button", { name: /copied!/i })).toBeInTheDocument();

    act(() => jest.advanceTimersByTime(2100));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument()
    );
    jest.useRealTimers();
  });

  // ── QR code ───────────────────────────────────────────────────────────────

  it("shows QR code when 'Show QR' is clicked after generation", async () => {
    const user = userEvent.setup();
    render(<PaymentLinkGenerator />);

    await fillForm(user)();
    await user.click(screen.getByRole("button", { name: /create payment link/i }));
    await user.click(screen.getByRole("button", { name: /show qr/i }));

    const qr = screen.getByTestId("qr-code");
    expect(qr).toBeInTheDocument();
    expect(qr).toHaveAttribute("data-value", FAKE_URL);
  });

  it("hides QR code when 'Hide QR' is clicked", async () => {
    const user = userEvent.setup();
    render(<PaymentLinkGenerator />);

    await fillForm(user)();
    await user.click(screen.getByRole("button", { name: /create payment link/i }));
    await user.click(screen.getByRole("button", { name: /show qr/i }));
    await user.click(screen.getByRole("button", { name: /hide qr/i }));

    expect(screen.queryByTestId("qr-code")).not.toBeInTheDocument();
  });

  // ── Link history ──────────────────────────────────────────────────────────

  it("shows link history section when 'Show Link History' is clicked", async () => {
    const user = userEvent.setup();
    render(<PaymentLinkGenerator />);

    await user.click(screen.getByRole("button", { name: /show link history/i }));
    expect(screen.getByText(/no links found/i)).toBeInTheDocument();
  });

  it("calls rememberPaymentLink after generating a link", async () => {
    const user = userEvent.setup();
    render(<PaymentLinkGenerator />);

    await fillForm(user)();
    await user.click(screen.getByRole("button", { name: /create payment link/i }));

    expect(mockRememberPaymentLink).toHaveBeenCalledTimes(1);
  });
});
