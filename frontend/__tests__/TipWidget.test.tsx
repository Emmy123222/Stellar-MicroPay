import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TipWidget from "@/components/TipWidget";
import { getXLMBalance } from "@/lib/stellar";

const mockSendPaymentForm = jest.fn();

jest.mock("@/components/SendPaymentForm", () => ({
  __esModule: true,
  default: (props: any) => {
    mockSendPaymentForm(props);

    return (
      <div data-testid="send-payment-form">
        <div data-testid="prefill-amount">{props.prefill?.amount}</div>
        <button type="button" onClick={props.onSuccess}>
          Complete tip
        </button>
      </div>
    );
  },
}));

jest.mock("@/components/WalletConnect", () => ({
  __esModule: true,
  default: ({ onConnect }: { onConnect: (publicKey: string) => void }) => (
    <button type="button" onClick={() => onConnect(`G${"B".repeat(55)}`)}>
      Mock wallet connect
    </button>
  ),
}));

jest.mock("@/lib/stellar", () => ({
  getXLMBalance: jest.fn(),
  shortenAddress: (address: string) => `${address.slice(0, 6)}...${address.slice(-6)}`,
}));

describe("TipWidget", () => {
  const destination = `G${"A".repeat(55)}`;

  beforeEach(() => {
    mockSendPaymentForm.mockClear();
    (getXLMBalance as jest.Mock).mockResolvedValue("25.5000000");
  });

  it("shows the wallet connect prompt only after an unconnected user clicks the tip CTA", async () => {
    const user = userEvent.setup();

    render(
      <TipWidget
        creatorUsername="alice"
        destination={destination}
        publicKey={null}
        onConnect={jest.fn()}
      />
    );

    expect(screen.queryByText("Mock wallet connect")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /connect wallet to tip 0.5 xlm/i }));

    expect(screen.getByText("Mock wallet connect")).toBeInTheDocument();
  });

  it("uses preset and custom amounts to prefill the existing send form", async () => {
    const user = userEvent.setup();

    render(
      <TipWidget
        creatorUsername="alice"
        destination={destination}
        publicKey={`G${"C".repeat(55)}`}
        onConnect={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(mockSendPaymentForm).toHaveBeenCalled();
    });

    expect(screen.getByTestId("prefill-amount")).toHaveTextContent("0.5");

    await user.click(screen.getByRole("button", { name: /\$20 tip/i }));

    await waitFor(() => {
      expect(screen.getByTestId("prefill-amount")).toHaveTextContent("10");
    });

    const customAmountInput = screen.getByLabelText(/custom amount/i);
    await user.clear(customAmountInput);
    await user.type(customAmountInput, "3.25");

    await waitFor(() => {
      expect(screen.getByTestId("prefill-amount")).toHaveTextContent("3.25");
    });
  });

  it("shows a success banner after a completed tip", async () => {
    const user = userEvent.setup();

    render(
      <TipWidget
        creatorUsername="alice"
        destination={destination}
        publicKey={`G${"D".repeat(55)}`}
        onConnect={jest.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /complete tip/i }));

    expect(screen.getByText("Tip sent to @alice")).toBeInTheDocument();
  });
});
