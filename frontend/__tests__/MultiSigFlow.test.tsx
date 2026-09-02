import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import MultiSigFlow, {
  MULTISIG_FLOW_STEPS,
  MULTISIG_THRESHOLD_XLM,
  loadMultiSigDraft,
  saveMultiSigDraft,
  clearMultiSigDraft,
} from "@components/MultiSigFlow";

jest.mock("@lib/stellar", () => ({
  buildPaymentTransaction: jest.fn(),
  collectSignatures: jest.fn(),
  submitTransaction: jest.fn(),
  isValidStellarAddress: jest.fn((addr: string) => addr.startsWith("G") && addr.length === 56),
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  getNetworkConfig: () => ({ network: "testnet", horizonUrl: "https://horizon-testnet.stellar.org" }),
}));

jest.mock("@lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(),
}));

const PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const DESTINATION = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("MultiSigFlow — accessible stepper & draft persistence (#825)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("exposes an ordered step list with aria-current on the active step", () => {
    render(
      <MultiSigFlow
        publicKey={PUBLIC_KEY}
        xlmBalance="500"
        defaultStep="collect"
        defaultThreshold={3}
      />
    );

    const progress = screen.getByRole("navigation", {
      name: "Multi-signature payment progress",
    });
    const steps = progress.querySelectorAll("li");
    expect(steps).toHaveLength(MULTISIG_FLOW_STEPS.length);

    const currentStep = progress.querySelector('[aria-current="step"]');
    expect(currentStep).toHaveTextContent("Collect");
  });

  it("announces the current signature count in a live region", () => {
    render(
      <MultiSigFlow
        publicKey={PUBLIC_KEY}
        xlmBalance="500"
        defaultStep="collect"
        defaultThreshold={2}
        defaultInitiatorSignedXDR="AAAA-stub-initiator-xdr"
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Signatures collected: 1 of 2");
  });

  it("announces when the signature threshold is met", () => {
    render(
      <MultiSigFlow
        publicKey={PUBLIC_KEY}
        xlmBalance="500"
        defaultStep="collect"
        defaultThreshold={2}
        defaultInitiatorSignedXDR="AAAA-stub-initiator-xdr"
        defaultCosignerXDRs={["AAAA-stub-cosigner-xdr"]}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Signatures collected: 2 of 2");
  });

  it("announces step transitions in a live region", async () => {
    const user = userEvent.setup();
    render(
      <MultiSigFlow
        publicKey={PUBLIC_KEY}
        xlmBalance="500"
        defaultStep="collect"
        defaultThreshold={2}
        defaultInitiatorSignedXDR="AAAA-stub-initiator-xdr"
        defaultCosignerXDRs={["AAAA-stub-cosigner-xdr"]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Proceed to Submit →" }));

    expect(screen.getByRole("status")).toHaveTextContent("Step 5 of 5: Submit");
  });

  it("moves focus to the step panel after a step transition", async () => {
    const user = userEvent.setup();
    render(
      <MultiSigFlow
        publicKey={PUBLIC_KEY}
        xlmBalance="500"
        defaultStep="share"
        defaultThreshold={2}
        defaultInitiatorSignedXDR="AAAA-stub-initiator-xdr"
      />
    );

    const panel = screen.getByLabelText("Share");
    expect(panel).toHaveAttribute("tabindex", "-1");

    await user.click(screen.getByRole("button", { name: "Collect Co-Signer Signatures →" }));
    expect(document.activeElement).toBe(panel);
  });

  it("persists and restores minimum draft metadata namespaced by network and account", () => {
    saveMultiSigDraft(PUBLIC_KEY, {
      step: "collect",
      destination: DESTINATION,
      amount: "150",
      memo: "test draft",
      threshold: 2,
      unsignedXDR: "AAAA-unsigned",
      initiatorSignedXDR: "AAAA-initiator",
      cosignerXDRs: ["AAAA-cosign"],
    });

    const draft = loadMultiSigDraft(PUBLIC_KEY);
    expect(draft).not.toBeNull();
    expect(draft?.step).toBe("collect");
    expect(draft?.destination).toBe(DESTINATION);
    expect(draft?.amount).toBe("150");
    expect(draft?.threshold).toBe(2);

    // Render component without defaultStep to verify auto-restore
    render(<MultiSigFlow publicKey={PUBLIC_KEY} xlmBalance="500" />);
    expect(screen.getByRole("status")).toHaveTextContent("Signatures collected: 2 of 2");
  });

  it("allows explicit discard of the persisted draft", async () => {
    const user = userEvent.setup();
    saveMultiSigDraft(PUBLIC_KEY, {
      step: "collect",
      destination: DESTINATION,
      amount: "150",
      memo: "test draft",
      threshold: 2,
      unsignedXDR: "AAAA-unsigned",
      initiatorSignedXDR: "AAAA-initiator",
      cosignerXDRs: ["AAAA-cosign"],
    });

    render(<MultiSigFlow publicKey={PUBLIC_KEY} xlmBalance="500" />);
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(loadMultiSigDraft(PUBLIC_KEY)).toBeNull();
    expect(screen.getByText("Build Multi-Signature Payment")).toBeInTheDocument();
  });

  it("exports the multi-sig threshold constant for callers", () => {
    expect(MULTISIG_THRESHOLD_XLM).toBe(100);
  });
});
