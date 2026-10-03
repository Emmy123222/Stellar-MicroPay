import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import type { Transaction } from "@stellar/stellar-sdk";
import IssueTokenPage from "@/pages/issue-token";

const ISSUER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const DISTRIBUTOR = "GB62CUHQB72WRU3LZFL5BIXMQVQ22MJCDX4FZUBGBQH3PPPPS6INOCLV";

const mockUseWallet = jest.fn();
jest.mock("@/lib/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock("@/components/WalletConnect", () => () => <div>Wallet Connect</div>);

const mockSignTransactionWithWallet = jest.fn();
const mockGetConnectedPublicKey = jest.fn();
jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: (...args: unknown[]) =>
    mockSignTransactionWithWallet(...args),
  getConnectedPublicKey: (...args: unknown[]) => mockGetConnectedPublicKey(...args),
}));

jest.mock("@/lib/stellar", () => {
  const actual = jest.requireActual("@/lib/stellar");
  return {
    ...actual,
    buildChangeTrustTransaction: jest.fn(),
    buildAssetIssueTransaction: jest.fn(),
    buildHomeDomainTransaction: jest.fn(),
    submitTransaction: jest.fn(),
  };
});

// Imported after the mock is registered so we assert against the mocked fns.
const stellar = jest.requireMock("@/lib/stellar") as {
  buildChangeTrustTransaction: jest.Mock;
  buildAssetIssueTransaction: jest.Mock;
  buildHomeDomainTransaction: jest.Mock;
  submitTransaction: jest.Mock;
  assetExplorerUrl: (code: string, issuer: string) => string;
  stellarTomlUrl: (domain: string) => string;
};

const fakeTransaction = { toXDR: () => "unsigned-xdr" } as unknown as Transaction;

/**
 * Render the wizard and walk it to the requested step with valid input.
 * Step 4 is left un-issued so tests can drive the issuance themselves; step 5
 * issues the asset and continues.
 */
async function advanceTo(step: 2 | 3 | 4 | 5) {
  render(<IssueTokenPage />);
  const user = userEvent.setup();

  // Step 1 → 2
  await user.type(screen.getByLabelText(/asset code/i), "COOL");
  await user.click(screen.getByRole("button", { name: /continue/i }));

  if (step === 2) return user;

  // Step 2 → 3
  await waitFor(() =>
    expect(screen.getByLabelText(/issuer account/i)).toHaveValue(ISSUER)
  );
  await user.click(screen.getByRole("button", { name: /continue/i }));

  if (step === 3) return user;

  // Step 3: create the distributor trustline.
  mockGetConnectedPublicKey.mockResolvedValue(DISTRIBUTOR);
  stellar.buildChangeTrustTransaction.mockResolvedValue(fakeTransaction);
  stellar.submitTransaction.mockResolvedValue({ hash: "trustline-hash" });
  mockSignTransactionWithWallet.mockResolvedValue({
    signedXDR: "signed-xdr",
    error: null,
  });

  await user.type(screen.getByLabelText(/distributor account/i), DISTRIBUTOR);
  await user.click(screen.getByRole("button", { name: /create trustline/i }));
  await waitFor(() =>
    expect(screen.getByText(/distributor trustline created/i)).toBeInTheDocument()
  );
  await user.click(screen.getByRole("button", { name: /continue/i }));

  // Step 4 is now on screen; from here the issuer signs.
  mockGetConnectedPublicKey.mockResolvedValue(ISSUER);
  stellar.buildAssetIssueTransaction.mockResolvedValue(fakeTransaction);
  stellar.submitTransaction.mockResolvedValue({ hash: "issue-hash" });

  if (step === 4) return user;

  // Step 4 → 5
  await user.click(screen.getByRole("button", { name: /^issue COOL$/i }));
  await waitFor(() =>
    expect(screen.getByText(/asset issued to the distributor/i)).toBeInTheDocument()
  );
  await user.click(screen.getByRole("button", { name: /continue/i }));

  return user;
}

describe("Issue token wizard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWallet.mockReturnValue({
      publicKey: ISSUER,
      connectWallet: jest.fn(),
      disconnectWallet: jest.fn(),
      isWalletReady: true,
    });
    mockGetConnectedPublicKey.mockResolvedValue(ISSUER);
    mockSignTransactionWithWallet.mockResolvedValue({
      signedXDR: "signed-xdr",
      error: null,
    });
  });

  it("asks the user to connect a wallet when none is connected", () => {
    mockUseWallet.mockReturnValue({
      publicKey: null,
      connectWallet: jest.fn(),
      disconnectWallet: jest.fn(),
      isWalletReady: true,
    });

    render(<IssueTokenPage />);

    expect(screen.getByText("Wallet Connect")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /issuance progress/i })).not.toBeInTheDocument();
  });

  it("renders a five-step progress indicator with step 1 current", () => {
    render(<IssueTokenPage />);

    const progress = screen.getByRole("list", { name: /issuance progress/i });
    expect(progress.querySelectorAll("li")).toHaveLength(5);
    expect(screen.getByLabelText(/asset code/i)).toBeInTheDocument();
    expect(
      screen.getByText(/step 1 of 5: asset code/i)
    ).toBeInTheDocument();
  });

  it("rejects asset codes with spaces and blocks Continue", async () => {
    const user = userEvent.setup();
    render(<IssueTokenPage />);

    await user.type(screen.getByLabelText(/asset code/i), "CO OL");

    expect(screen.getByText(/cannot contain spaces/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("rejects the reserved XLM code", async () => {
    const user = userEvent.setup();
    render(<IssueTokenPage />);

    await user.type(screen.getByLabelText(/asset code/i), "xlm");

    expect(screen.getByText(/reserved for the native Stellar asset/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("accepts a valid asset code and uppercases the input", async () => {
    const user = userEvent.setup();
    render(<IssueTokenPage />);

    await user.type(screen.getByLabelText(/asset code/i), "cool2");

    expect(screen.getByLabelText(/asset code/i)).toHaveValue("COOL2");
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });

  it("defaults the issuer to the connected wallet and validates a manual entry", async () => {
    const user = userEvent.setup();
    await advanceTo(2);

    const issuerInput = screen.getByLabelText(/issuer account/i);
    expect(issuerInput).toHaveValue(ISSUER);
    expect(screen.getByText(/using your connected wallet/i)).toBeInTheDocument();

    await user.clear(issuerInput);
    await user.type(issuerInput, "not-a-key");

    expect(screen.getByText(/valid Stellar public key/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("refuses to sign the trustline when Freighter is on the wrong account", async () => {
    const user = await advanceTo(3);

    mockGetConnectedPublicKey.mockResolvedValue(ISSUER);
    stellar.buildChangeTrustTransaction.mockResolvedValue(fakeTransaction);

    await user.type(screen.getByLabelText(/distributor account/i), DISTRIBUTOR);
    await user.click(screen.getByRole("button", { name: /create trustline/i }));

    expect(
      await screen.findByText(/Freighter is currently on/i)
    ).toBeInTheDocument();
    expect(stellar.submitTransaction).not.toHaveBeenCalled();
  });

  it("requires a distributor different from the issuer", async () => {
    const user = await advanceTo(3);

    await user.type(screen.getByLabelText(/distributor account/i), ISSUER);

    expect(
      screen.getByText(/must be a different account than the issuer/i)
    ).toBeInTheDocument();
  });

  it("signs and submits each step as its own transaction", async () => {
    const user = await advanceTo(4);

    // Step 3 already signed one transaction.
    expect(mockSignTransactionWithWallet).toHaveBeenCalledTimes(1);
    expect(stellar.submitTransaction).toHaveBeenCalledWith("signed-xdr");

    await user.click(screen.getByRole("button", { name: /^issue COOL$/i }));

    await waitFor(() =>
      expect(screen.getByText(/asset issued to the distributor/i)).toBeInTheDocument()
    );
    expect(mockSignTransactionWithWallet).toHaveBeenCalledTimes(2);
    expect(stellar.buildAssetIssueTransaction).toHaveBeenCalledWith({
      issuerPublicKey: ISSUER,
      distributorPublicKey: DISTRIBUTOR,
      assetCode: "COOL",
      amount: "1000.0000000",
    });

    await user.click(screen.getByRole("button", { name: /continue/i }));

    // Step 5 – optional home domain signs a third, separate transaction.
    stellar.buildHomeDomainTransaction.mockResolvedValue(fakeTransaction);
    stellar.submitTransaction.mockResolvedValue({ hash: "home-hash" });

    await user.type(screen.getByLabelText(/home domain/i), "example.com");
    await user.click(screen.getByRole("button", { name: /set home domain/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/home domain set on the issuer account/i)
      ).toBeInTheDocument()
    );
    expect(stellar.buildHomeDomainTransaction).toHaveBeenCalledWith({
      publicKey: ISSUER,
      homeDomain: "example.com",
    });
    expect(mockSignTransactionWithWallet).toHaveBeenCalledTimes(3);
  });

  it("shows the asset summary and a Stellar Expert link on the final step", async () => {
    const user = await advanceTo(4);

    await user.click(screen.getByRole("button", { name: /^issue COOL$/i }));
    await waitFor(() =>
      expect(screen.getByText(/asset issued to the distributor/i)).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      screen.getByRole("heading", { name: "COOL issued" })
    ).toBeInTheDocument();

    const explorerLink = screen.getByRole("link", {
      name: /view COOL on Stellar Expert/i,
    });
    expect(explorerLink).toHaveAttribute(
      "href",
      stellar.assetExplorerUrl("COOL", ISSUER)
    );

    expect(screen.getByText(DISTRIBUTOR)).toBeInTheDocument();
    expect(screen.getByText(/1,000 COOL/)).toBeInTheDocument();
  });

  it("previews and offers a downloadable stellar.toml", async () => {
    await advanceTo(5);

    const toml = screen.getByText(/\[\[CURRENCIES\]\]/);
    expect(toml).toBeInTheDocument();
    expect(toml.textContent).toContain('code = "COOL"');
    expect(toml.textContent).toContain(`issuer = "${ISSUER}"`);

    const download = screen.getByRole("link", { name: /download stellar\.toml/i });
    expect(download).toHaveAttribute("download", "stellar.toml");
  });
});
