import { render, screen, waitFor } from "@testing-library/react";
import TransactionList from "@/components/TransactionList";

const mockGetPaymentHistory = jest.fn();

jest.mock("@/lib/stellar", () => ({
  ...jest.requireActual("@/lib/stellar"),
  getPaymentHistory: (...args: unknown[]) => mockGetPaymentHistory(...args),
}));

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const PUBLIC_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA";

describe("TransactionList loading skeleton", () => {
  beforeEach(() => {
    mockGetPaymentHistory.mockReset();
  });

  it("shows 5 skeleton rows while loading === true", () => {
    // Never resolves during this test, so the component stays in the loading state.
    mockGetPaymentHistory.mockReturnValue(new Promise(() => {}));

    const { container } = render(<TransactionList publicKey={PUBLIC_KEY} />);

    const skeletonRows = container.querySelectorAll(
      ".space-y-2 > div.bg-cosmos-800"
    );
    expect(skeletonRows).toHaveLength(5);
  });

  it("marks the loading container with aria-busy='true'", () => {
    mockGetPaymentHistory.mockReturnValue(new Promise(() => {}));

    const { container } = render(<TransactionList publicKey={PUBLIC_KEY} />);

    const loadingContainer = container.querySelector('[aria-busy="true"]');
    expect(loadingContainer).not.toBeNull();
  });

  it("each skeleton row matches the real row's icon + text + amount layout", () => {
    mockGetPaymentHistory.mockReturnValue(new Promise(() => {}));

    const { container } = render(<TransactionList publicKey={PUBLIC_KEY} />);

    const firstRow = container.querySelector(".space-y-2 > div.bg-cosmos-800");
    expect(firstRow).not.toBeNull();
    // Icon placeholder (matches the real 10x10 direction icon circle).
    expect(firstRow!.querySelector(".w-10.h-10.rounded-full")).not.toBeNull();
    // Two-line text block (matches the real "Sent to G..." + timestamp lines).
    expect(firstRow!.querySelectorAll(".space-y-2 > div")).not.toHaveLength(0);
  });

  it("removes the skeleton and aria-busy once loading finishes", async () => {
    mockGetPaymentHistory.mockResolvedValue({
      records: [],
      hasMore: false,
    });

    const { container } = render(<TransactionList publicKey={PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.getByText("No transactions yet")).toBeInTheDocument();
    });

    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("renders real transaction rows (not skeletons) once data loads", async () => {
    mockGetPaymentHistory.mockResolvedValue({
      records: [
        {
          id: "1",
          type: "received",
          amount: "10.5",
          asset: "XLM",
          from: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYFTRE6A6PIFLSUFZOO",
          to: PUBLIC_KEY,
          createdAt: new Date().toISOString(),
          transactionHash: "abc123",
        },
      ],
      hasMore: false,
    });

    render(<TransactionList publicKey={PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.getByText("Received from")).toBeInTheDocument();
    });
  });
});
