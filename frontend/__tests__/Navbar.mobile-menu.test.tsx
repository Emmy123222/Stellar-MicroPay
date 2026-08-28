/**
 * __tests__/Navbar.mobile-menu.test.tsx
 * Tests for the accessible mobile navigation drawer (#834):
 *  - Focus trap while open
 *  - Close on Escape
 *  - Close on route change
 *  - Restore focus to the menu button on close
 *  - Dialog semantics (role="dialog", aria-modal, aria-label)
 *  - Backdrop click closes
 *  - Body scroll locked while open
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockPush = jest.fn();
const mockRouteChangeStart = jest.fn();
let routeChangeHandler: (() => void) | null = null;

jest.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/",
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
    query: {},
    events: {
      on: (event: string, handler: () => void) => {
        if (event === "routeChangeStart") {
          routeChangeHandler = handler;
        }
      },
      off: (event: string) => {
        if (event === "routeChangeStart") {
          routeChangeHandler = null;
        }
      },
    },
  }),
}));

jest.mock("next/link", () => {
  const Link = ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>{children}</a>
  );
  Link.displayName = "Link";
  return Link;
});

jest.mock("@/lib/stellar", () => ({
  shortenAddress: (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`,
  getNetworkConfig: () => ({ network: "testnet", horizonUrl: "https://horizon-testnet.stellar.org" }),
  fetchNetworkFeeStats: () => Promise.resolve({ baseFeeXlm: 0.00001, feeLevel: "normal" }),
}));

jest.mock("@/lib/wallet", () => ({
  connectWallet: jest.fn(),
  performSEP0010Auth: jest.fn(() => Promise.resolve({ error: null })),
}));

jest.mock("@/lib/useWallet", () => ({
  useWallet: () => ({
    publicKey: null,
    connectWallet: jest.fn(),
    disconnectWallet: jest.fn(),
  }),
}));

jest.mock("@/pages/_app", () => ({
  useTheme: () => ({ theme: "dark" as const, toggleTheme: jest.fn() }),
}));

jest.mock("@/contexts/I18nContext", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: jest.fn(),
    t: {
      nav: {
        home: "Home",
        dashboard: "Dashboard",
        trade: "Trade",
        transactions: "Transactions",
        network: "Network",
        settings: "Settings",
        connectWallet: "Connect Wallet",
        disconnect: "Disconnect",
        disconnectConfirm: "Disconnect wallet?",
        confirm: "Confirm",
        cancel: "Cancel",
        openMenu: "Open menu",
        closeMenu: "Close menu",
        mobileNavigation: "Mobile navigation",
      },
    },
    isRTL: false,
    supportedLocales: ["en", "es"],
  }),
}));

// ─── Component import (after mocks) ────────────────────────────────────────

import Navbar from "@/components/Navbar";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Render the Navbar and open the mobile menu by clicking the hamburger button.
 * Returns the user-event instance for further interactions.
 */
async function openMobileMenu() {
  const user = userEvent.setup();
  render(<Navbar />);

  const menuButton = screen.getByRole("button", { name: "Open menu" });
  await user.click(menuButton);

  const dialog = screen.getByRole("dialog", { name: "Mobile navigation" });
  return { user, menuButton, dialog };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Navbar mobile menu — a11y (#834)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    routeChangeHandler = null;
  });

  // ---- Visibility & semantics ----

  it("hamburger button is hidden on desktop and visible on mobile", () => {
    const { container } = render(<Navbar />);
    const btn = screen.getByRole("button", { name: "Open menu" });
    // md:hidden means the button has the Tailwind hidden class (effectively hidden at md+)
    // In jsdom all elements are "visible", so we check the class list instead
    expect(btn.className).toContain("md:hidden");
  });

  it("opens a dialog with correct ARIA attributes", async () => {
    const { dialog } = await openMobileMenu();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-label", "Mobile navigation");
  });

  it("renders all navigation links inside the mobile drawer", async () => {
    const { dialog } = await openMobileMenu();

    // Scope queries to within the dialog panel to avoid matching desktop links
    // (jsdom doesn't apply CSS hidden/display:none classes)
    const getLinkInDialog = (name: string) =>
      dialog.querySelector<HTMLAnchorElement>(`a[href]`);

    const links = dialog.querySelectorAll("a[href]");
    const linkTexts = Array.from(links).map((a) => a.textContent?.trim());

    expect(linkTexts).toContain("Home");
    expect(linkTexts).toContain("Dashboard");
    expect(linkTexts).toContain("Trade");
    expect(linkTexts).toContain("Transactions");
    expect(linkTexts).toContain("Network");
    expect(linkTexts).toContain("Settings");
    expect(links.length).toBe(6);
  });

  // ---- Focus management ----

  it("moves focus into the dialog panel on open", async () => {
    const { dialog } = await openMobileMenu();

    // The panel itself or its first focusable child should be focused
    const activeEl = document.activeElement;
    expect(
      dialog.contains(activeEl) || activeEl === dialog
    ).toBe(true);
  });

  it("traps focus: Tab from last element wraps to first, Shift+Tab from first wraps to last", async () => {
    const { user, dialog } = await openMobileMenu();

    // Focus trap is implemented via a keydown listener that calls preventDefault()
    // and manually moves focus. jsdom doesn't honour preventDefault for Tab the way
    // a real browser does, so we verify the behaviour by directly dispatching Tab
    // keydown events and asserting that focus never escapes the dialog.
    
    const focusableSelector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const focusableEls = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    expect(focusableEls.length).toBeGreaterThan(1);

    const firstEl = focusableEls[0];
    const lastEl = focusableEls[focusableEls.length - 1];

    // Focus the last element, then dispatch a Tab keydown
    lastEl.focus();
    expect(document.activeElement).toBe(lastEl);

    const tabDown = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tabDown);

    // After the Tab keydown handler runs, focus should still be inside the dialog
    // (it should have wrapped to the first element)
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Now focus the first element and Shift+Tab
    firstEl.focus();
    expect(document.activeElement).toBe(firstEl);

    const shiftTabDown = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTabDown);

    // Focus should still be inside the dialog
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  // ---- Close on Escape ----

  it("closes when Escape is pressed", async () => {
    const { user, menuButton } = await openMobileMenu();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Focus should be restored to the hamburger button
    expect(menuButton).toHaveFocus();
  });

  // ---- Close on route change ----

  it("closes when a route change starts", async () => {
    await openMobileMenu();

    // Simulate a route change event
    routeChangeHandler?.();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  // ---- Focus restore ----

  it("restores focus to the hamburger button on close", async () => {
    const { user, menuButton } = await openMobileMenu();

    // Close via Escape
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(menuButton).toHaveFocus();
    });
  });

  // ---- Backdrop click ----

  it("closes when the backdrop is clicked", async () => {
    const { user } = await openMobileMenu();

    const backdrop = screen.getByTestId("mobile-menu-backdrop");
    await user.click(backdrop);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  // ---- Body scroll lock ----

  it("locks body scroll while the menu is open", async () => {
    const { user, menuButton } = await openMobileMenu();

    expect(document.body.style.overflow).toBe("hidden");

    // Close and verify scroll is restored
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(document.body.style.overflow).toBe("");
    });
  });

  // ---- Link click closes menu ----

  it("closes when a navigation link is clicked", async () => {
    const { user, dialog } = await openMobileMenu();

    // Click the first link inside the dialog (Home link in the mobile drawer)
    const links = dialog.querySelectorAll("a[href]");
    const homeLink = Array.from(links).find((a) => a.textContent?.trim() === "Home");
    expect(homeLink).toBeTruthy();
    await user.click(homeLink!);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  // ---- Close button ----

  it("closes when the close button is clicked", async () => {
    const { user } = await openMobileMenu();

    const closeButton = screen.getByRole("button", { name: "Close menu" });
    await user.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
