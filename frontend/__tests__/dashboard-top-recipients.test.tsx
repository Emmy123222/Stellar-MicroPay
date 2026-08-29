import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TopRecipientsWidget } from "@/components/dashboard/TopRecipientsWidget";

jest.mock("@/utils/format", () => ({
  shortenAddress: (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`,
}));

describe("TopRecipientsWidget", () => {
  it("renders loading skeleton when loading", () => {
    render(<TopRecipientsWidget recipients={[]} loading={true} />);
    expect(screen.getByText("Top Recipients")).toBeInTheDocument();
  });

  it("renders empty state when no recipients", () => {
    render(<TopRecipientsWidget recipients={[]} loading={false} />);
    expect(screen.getByText("No sent payments yet.")).toBeInTheDocument();
  });

  it("renders ranked recipients with addresses and amounts", () => {
    const recipients = [
      { address: "GAAAAAA111111111111111111111111111111111111111111", totalXLMSent: "100.0000000" },
      { address: "GBBBBBB222222222222222222222222222222222222222222", totalXLMSent: "50.5000000" },
    ];
    render(<TopRecipientsWidget recipients={recipients} loading={false} />);
    expect(screen.getByText("100.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("50.50 XLM")).toBeInTheDocument();
  });
});
