import { render, screen, waitFor } from "@testing-library/react";
import TipPage from "@/pages/tip/[username]";
import { useRouter } from "next/router";

jest.mock("next/router", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/components/TipWidget", () => ({
  __esModule: true,
  default: ({
    creatorUsername,
    destination,
  }: {
    creatorUsername: string;
    destination: string;
  }) => (
    <div data-testid="tip-widget">
      {creatorUsername}:{destination}
    </div>
  ),
}));

describe("tip page", () => {
  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue({
      isReady: true,
      query: { username: "alice" },
    });

    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("loads the tip widget for a resolved username", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          username: "alice",
          publicKey: `G${"A".repeat(55)}`,
        },
      }),
    });

    render(<TipPage publicKey={null} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("tip-widget")).toHaveTextContent(`alice:G${"A".repeat(55)}`);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/accounts/resolve/alice")
    );
  });

  it("shows a friendly not-found state for an invalid username", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: "Username not found",
      }),
    });

    render(<TipPage publicKey={null} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Creator not found")).toBeInTheDocument();
    });

    expect(screen.getByText("Username not found")).toBeInTheDocument();
  });
});
