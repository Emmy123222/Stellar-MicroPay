import { fireEvent, render, screen } from "@testing-library/react";
import QRCodeModal from "@/components/QRCodeModal";

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
