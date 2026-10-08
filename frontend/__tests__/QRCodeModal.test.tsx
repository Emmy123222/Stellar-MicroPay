import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import QRCodeModal from '../components/QRCodeModal';

describe('QRCodeModal snapshot tests', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    publicKey: 'GABCDE1234567890GABCDE1234567890GABCDE1234567890GABCDE12',
    amount: undefined,
  };

  it('renders with sample address (no amount)', () => {
    const { container } = render(<QRCodeModal {...defaultProps} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders with sample address and amount', () => {
    const { container } = render(
      <QRCodeModal {...defaultProps} amount="10.5" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders with sample address and zero amount', () => {
    const { container } = render(
      <QRCodeModal {...defaultProps} amount="0" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders closed state (isOpen=false)', () => {
    const { container } = render(
      <QRCodeModal {...defaultProps} isOpen={false} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders with a different sample address', () => {
    const { container } = render(
      <QRCodeModal
        {...defaultProps}
        publicKey='GDIFFERENTADDRESS123456789012345678901234567890123456'
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe("QRCodeModal", () => {
  it("renders the QR canvas and downloads a PNG object URL", () => {
    const createObjectURL = jest.fn(() => "blob:qr");
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
    HTMLCanvasElement.prototype.toBlob = (callback) =>
      callback(new Blob(["qr"], { type: "image/png" }));

    render(
      <QRCodeModal
        isOpen
        onClose={jest.fn()}
        publicKey="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      />
    );

    expect(document.querySelector("canvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /download qr/i }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:qr");
  });
});
