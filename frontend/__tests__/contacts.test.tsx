import { render, screen, waitFor } from "@testing-library/react";
import Contacts from "@/pages/contacts";

const mockUseWallet = jest.fn();

jest.mock("@/lib/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("@/lib/stellar", () => ({
  shortenAddress: jest.fn((address: string) => address),
  isValidStellarAddress: jest.fn(() => true),
  resolveFederationAddress: jest.fn(),
}));

describe("Contacts", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ publicKey: `G${"A".repeat(55)}` });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows a warning when localStorage is unavailable", async () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage is unavailable");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage is unavailable");
    });

    render(<Contacts />);

    await waitFor(() => {
      expect(
        screen.getByText("Contacts won't be saved in private/incognito mode")
      ).toHaveAttribute("role", "status");
    });
  });
});
