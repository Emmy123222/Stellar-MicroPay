import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Navbar from "@/components/Navbar";
import { useWallet } from "@/lib/useWallet";
import { useTheme } from "@/pages/_app";
import { getNetworkConfig, fetchNetworkFeeStats } from "@/lib/stellar";

jest.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/",
    route: "/",
    asPath: "/",
    query: {},
    push: jest.fn(),
    replace: jest.fn(),
    events: { on: jest.fn(), off: jest.fn(), trigger: jest.fn() },
  }),
}));

jest.mock("@/lib/useWallet", () => ({
  useWallet: jest.fn(),
}));

jest.mock("@/pages/_app", () => ({
  useTheme: jest.fn(),
}));

jest.mock("@/lib/stellar", () => ({
  shortenAddress: (address: string) =>
    `${address.slice(0, 6)}...${address.slice(-6)}`,
  getNetworkConfig: jest.fn(),
  fetchNetworkFeeStats: jest.fn(),
}));

const mockUseWallet = useWallet as jest.Mock;
const mockUseTheme = useTheme as jest.Mock;
const mockGetNetworkConfig = getNetworkConfig as jest.Mock;
const mockFetchNetworkFeeStats = fetchNetworkFeeStats as jest.Mock;

function setup() {
  mockUseWallet.mockReturnValue({
    publicKey: null,
    connectWallet: jest.fn(),
    disconnectWallet: jest.fn(),
    isWalletReady: true,
  });
  mockUseTheme.mockReturnValue({ theme: "dark", toggleTheme: jest.fn() });
  mockGetNetworkConfig.mockReturnValue({ network: "testnet" });
  mockFetchNetworkFeeStats.mockResolvedValue({ feeLevel: "normal" });

  return render(<Navbar />);
}

function getDrawer() {
  return screen.getByRole("dialog", { name: /site navigation/i });
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /open navigation menu/i }));
  return getDrawer();
}

describe("Navbar mobile menu", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the hamburger button and hides desktop links below the md breakpoint", () => {
    setup();

    expect(
      screen.getByRole("button", { name: /open navigation menu/i })
    ).toBeInTheDocument();

    // The horizontal link row is hidden at < 768px via a `hidden md:flex`
    // wrapper. jsdom cannot evaluate media queries, so assert on the
    // responsive classes rather than computed visibility.
    const desktopLink = screen.getAllByRole("link", { name: "Dashboard" })[0];
    expect(desktopLink.closest("div")).toHaveClass("hidden", "md:flex");

    // The drawer is not open yet, so its links are not rendered either.
    expect(screen.queryByRole("dialog", { name: /site navigation/i })).toBeNull();
  });

  it("opens a slide-down drawer with all nav links", async () => {
    const user = userEvent.setup();
    setup();

    const drawer = await openMenu(user);

    const expected = ["Home", "Dashboard", "Trade", "Transactions", "Network", "Settings"];
    for (const label of expected) {
      expect(within(drawer).getByRole("link", { name: label })).toBeInTheDocument();
    }

    // Aria state flips while open.
    expect(
      screen.getByRole("button", { name: /close navigation menu/i })
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the drawer when a link is clicked", async () => {
    const user = userEvent.setup();
    setup();

    const drawer = await openMenu(user);
    await user.click(within(drawer).getByRole("link", { name: "Dashboard" }));

    expect(screen.queryByRole("dialog", { name: /site navigation/i })).toBeNull();
  });

  it("closes the drawer on Escape and returns focus to the hamburger button", async () => {
    const user = userEvent.setup();
    setup();

    await openMenu(user);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: /site navigation/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /open navigation menu/i })
    ).toHaveFocus();
  });

  it("traps Tab focus inside the open drawer", async () => {
    const user = userEvent.setup();
    setup();

    const drawer = await openMenu(user);
    const links = within(drawer).getAllByRole("link");
    expect(links.length).toBeGreaterThan(1);

    // Focus starts on the first drawer link, Tab from the last wraps back to
    // the first.
    expect(links[0]).toHaveFocus();

    links[links.length - 1].focus();
    await user.tab();

    expect(links[0]).toHaveFocus();

    // Shift+Tab from the first link wraps forward to the last.
    await user.tab({ shift: true });

    expect(links[links.length - 1]).toHaveFocus();
  });

  it("closes the drawer when the hamburger button is toggled again", async () => {
    const user = userEvent.setup();
    setup();

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: /close navigation menu/i }));

    expect(screen.queryByRole("dialog", { name: /site navigation/i })).toBeNull();
  });

  it("locks body scroll while the drawer is open", async () => {
    const user = userEvent.setup();
    setup();

    await openMenu(user);
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });

  it("marks the active route link with aria-current", async () => {
    const user = userEvent.setup();
    setup();

    const drawer = await openMenu(user);
    const homeLink = within(drawer).getByRole("link", { name: "Home" });

    expect(homeLink).toHaveAttribute("aria-current", "page");
  });
});
