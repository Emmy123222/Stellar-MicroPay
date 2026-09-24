import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LOCALE_STORAGE_KEY } from "@/lib/i18n";
import { I18nProvider } from "@/contexts/I18nContext";
import SendPaymentForm from "@/components/SendPaymentForm";

jest.mock("@/lib/stellar", () => ({
  buildPaymentTransaction: jest.fn(),
  buildReceiptMintTransaction: jest.fn(),
  buildSorobanTipTransaction: jest.fn(),
  explorerUrl: jest.fn((hash: string) => `https://stellar.expert/tx/${hash}`),
  fetchNetworkFeeStats: jest
    .fn()
    .mockResolvedValue({ feeLevel: "normal", baseFeeXlm: 0.00001 }),
  isValidStellarAddress: jest.fn(
    (address: string) => address.startsWith("G") && address.length === 56
  ),
  memoTextByteLength: jest.fn((memo: string) => memo.length),
  server: { loadAccount: jest.fn() },
  STELLAR_BASE_FEE_XLM: 0.00001,
  STELLAR_MEMO_TEXT_MAX_BYTES: 28,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM: 1,
  submitTransaction: jest.fn(),
  truncateMemoText: jest.fn((memo: string) => memo),
  CONTRACT_ID: "",
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(),
}));

jest.mock("@/utils/format", () => ({
  formatXLM: jest.fn((amount: string) => `${parseFloat(amount).toFixed(7)} XLM`),
  shortenAddress: jest.fn((address: string) => address.slice(0, 6)),
}));

const PUBLIC_KEY = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ";

function renderForm() {
  return render(
    <I18nProvider>
      <SendPaymentForm publicKey={PUBLIC_KEY} xlmBalance="100.0000000" />
    </I18nProvider>
  );
}

describe("SendPaymentForm internationalisation", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders English by default", () => {
    renderForm();

    expect(screen.getByText("Send Payment")).toBeInTheDocument();
    expect(screen.getByText("Destination")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Payment note...")).toBeInTheDocument();
    expect(screen.getByText("Memo (optional)")).toBeInTheDocument();
  });

  it("renders Spanish when the stored locale is es", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "es");

    renderForm();

    expect(await screen.findByText("Enviar pago")).toBeInTheDocument();
    expect(screen.getByText("Destino")).toBeInTheDocument();
    expect(screen.getByText("Memo (opcional)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Nota del pago...")).toBeInTheDocument();
    expect(screen.getByText("Favoritos")).toBeInTheDocument();
    expect(screen.queryByText("Send Payment")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Payment note...")).not.toBeInTheDocument();
  });
});
