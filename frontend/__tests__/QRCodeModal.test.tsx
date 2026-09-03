import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import QRCodeModal from "@/components/QRCodeModal";

jest.mock("qrcode.react", () => {
  const React = require("react") as typeof import("react");

  return {
    QRCodeCanvas: React.forwardRef<HTMLCanvasElement, Record<string, unknown>>((props, ref) => (
      <canvas ref={ref} data-testid="qr-code-canvas" />
    )),
    QRCodeSVG: () => <svg data-testid="qr-code-svg" />,
  };
});

function ModalHarness() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open modal
      </button>
      <QRCodeModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        publicKey="GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567"
      />
    </div>
  );
}

const PUBLIC_KEY = "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567";

describe("QRCodeModal — address encoding & rendering (#511)", () => {
  it("renders a QR code canvas for the provided address", () => {
    render(<QRCodeModal isOpen onClose={jest.fn()} publicKey={PUBLIC_KEY} />);
    expect(screen.getByTestId("qr-code-canvas")).toBeInTheDocument();
  });

  it("encodes the address into the Stellar SEP-0007 payment URI", () => {
    render(<QRCodeModal isOpen onClose={jest.fn()} publicKey={PUBLIC_KEY} />);
    expect(screen.getByText(`web+stellar:pay?destination=${PUBLIC_KEY}`)).toBeInTheDocument();
  });

  it("appends amount to the URI when a positive amount is provided", () => {
    render(<QRCodeModal isOpen onClose={jest.fn()} publicKey={PUBLIC_KEY} amount="42.5" />);
    expect(
      screen.getByText(`web+stellar:pay?destination=${PUBLIC_KEY}&amount=42.5`)
    ).toBeInTheDocument();
  });

  it("omits amount from URI when amount is zero", () => {
    render(<QRCodeModal isOpen onClose={jest.fn()} publicKey={PUBLIC_KEY} amount="0" />);
    expect(screen.getByText(`web+stellar:pay?destination=${PUBLIC_KEY}`)).toBeInTheDocument();
  });

  it("updates the displayed URI when the publicKey prop changes", () => {
    const KEY_A = "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567";
    const KEY_B = "GXYZ1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567";
    const { rerender } = render(<QRCodeModal isOpen onClose={jest.fn()} publicKey={KEY_A} />);
    expect(screen.getByText(`web+stellar:pay?destination=${KEY_A}`)).toBeInTheDocument();

    rerender(<QRCodeModal isOpen onClose={jest.fn()} publicKey={KEY_B} />);
    expect(screen.getByText(`web+stellar:pay?destination=${KEY_B}`)).toBeInTheDocument();
  });

  it("calls onClose when the Close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<QRCodeModal isOpen onClose={onClose} publicKey={PUBLIC_KEY} />);

    await user.click(screen.getByRole("button", { name: /^Close$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the Close icon button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<QRCodeModal isOpen onClose={onClose} publicKey={PUBLIC_KEY} />);

    await user.click(screen.getByRole("button", { name: /Close QR code modal/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the Download QR button", () => {
    render(<QRCodeModal isOpen onClose={jest.fn()} publicKey={PUBLIC_KEY} />);
    expect(screen.getByRole("button", { name: /Download QR/i })).toBeInTheDocument();
  });

  it("renders nothing when isOpen is false", () => {
    render(<QRCodeModal isOpen={false} onClose={jest.fn()} publicKey={PUBLIC_KEY} />);
    expect(screen.queryByTestId("qr-code-canvas")).not.toBeInTheDocument();
  });
});

describe("QRCodeModal — focus trap & keyboard (#511)", () => {
  it("traps focus, closes on Escape, and returns focus to the opener", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    const opener = screen.getByRole("button", { name: "Open modal" });
    await user.click(opener);

    const closeButton = await screen.findByRole("button", { name: "Close QR code modal" });
    expect(closeButton).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: /Download QR/i })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: /^Close$/i })).toHaveFocus();

    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });
});
