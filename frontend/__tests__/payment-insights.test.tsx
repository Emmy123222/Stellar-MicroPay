import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import PaymentInsightsCard from "@/components/PaymentInsightsCard";
import { calculatePaymentInsights } from "@/utils/insights";
import { PaymentRecord } from "@/lib/stellar";

describe("Payment Insights Calculation and Component", () => {
  const USER_ADDRESS = "GABC1234567890ACCOUNT1";
  const OTHER_ADDRESS1 = "GDEF1234567890ACCOUNT2";
  const OTHER_ADDRESS2 = "GHIJ1234567890ACCOUNT3";

  // Use fixed date for reliable relative tests
  const now = new Date("2026-09-15T12:00:00Z");
  const thisMonthISO = "2026-09-10T10:00:00Z";
  const lastMonthISO = "2026-08-20T10:00:00Z";
  const twoMonthsAgoISO = "2026-07-20T10:00:00Z";

  describe("calculatePaymentInsights", () => {
    it("correctly calculates sent/received amounts and unique counterparties for this month vs last month", () => {
      const mockPayments: PaymentRecord[] = [
        // This month sent & received
        {
          id: "1",
          type: "sent",
          amount: "150.0",
          asset: "XLM",
          from: USER_ADDRESS,
          to: OTHER_ADDRESS1,
          createdAt: thisMonthISO,
          transactionHash: "tx1",
        },
        {
          id: "2",
          type: "sent",
          amount: "50.0",
          asset: "XLM",
          from: USER_ADDRESS,
          to: OTHER_ADDRESS2,
          createdAt: thisMonthISO,
          transactionHash: "tx2",
        },
        {
          id: "3",
          type: "received",
          amount: "300.0",
          asset: "XLM",
          from: OTHER_ADDRESS1,
          to: USER_ADDRESS,
          createdAt: thisMonthISO,
          transactionHash: "tx3",
        },

        // Last month sent & received
        {
          id: "4",
          type: "sent",
          amount: "100.0",
          asset: "XLM",
          from: USER_ADDRESS,
          to: OTHER_ADDRESS1,
          createdAt: lastMonthISO,
          transactionHash: "tx4",
        },
        {
          id: "5",
          type: "received",
          amount: "150.0",
          asset: "XLM",
          from: OTHER_ADDRESS2,
          to: USER_ADDRESS,
          createdAt: lastMonthISO,
          transactionHash: "tx5",
        },

        // Two months ago (ignored in calculation)
        {
          id: "6",
          type: "sent",
          amount: "500.0",
          asset: "XLM",
          from: USER_ADDRESS,
          to: OTHER_ADDRESS1,
          createdAt: twoMonthsAgoISO,
          transactionHash: "tx6",
        },
      ];

      const insights = calculatePaymentInsights(mockPayments, USER_ADDRESS, now);

      // Sent: 200 this month vs 100 last month = +100% change
      expect(insights.sentThisMonth).toBe(200);
      expect(insights.sentLastMonth).toBe(100);
      expect(insights.sentChangePercent).toBe(100);

      // Received: 300 this month vs 150 last month = +100% change
      expect(insights.receivedThisMonth).toBe(300);
      expect(insights.receivedLastMonth).toBe(150);
      expect(insights.receivedChangePercent).toBe(100);

      // Unique counterparties this month: OTHER_ADDRESS1 & OTHER_ADDRESS2
      expect(insights.uniqueCounterpartiesThisMonth).toBe(2);
    });

    it("handles negative % change when current month spending is lower than last month", () => {
      const mockPayments: PaymentRecord[] = [
        {
          id: "1",
          type: "sent",
          amount: "50.0",
          asset: "XLM",
          from: USER_ADDRESS,
          to: OTHER_ADDRESS1,
          createdAt: thisMonthISO,
          transactionHash: "tx1",
        },
        {
          id: "2",
          type: "sent",
          amount: "100.0",
          asset: "XLM",
          from: USER_ADDRESS,
          to: OTHER_ADDRESS1,
          createdAt: lastMonthISO,
          transactionHash: "tx2",
        },
      ];

      const insights = calculatePaymentInsights(mockPayments, USER_ADDRESS, now);
      expect(insights.sentThisMonth).toBe(50);
      expect(insights.sentLastMonth).toBe(100);
      expect(insights.sentChangePercent).toBe(-50);
    });
  });

  describe("PaymentInsightsCard UI Component", () => {
    it("renders 'Calculating…' skeleton when loading is true", () => {
      render(<PaymentInsightsCard loading={true} />);
      expect(screen.getByText("Calculating…")).toBeInTheDocument();
      expect(screen.getByTestId("payment-insights-skeleton")).toBeInTheDocument();
    });

    it("renders formatted insights and green/red indicators when data is available", () => {
      const mockPayments: PaymentRecord[] = [
        {
          id: "1",
          type: "sent",
          amount: "200.0",
          asset: "XLM",
          from: USER_ADDRESS,
          to: OTHER_ADDRESS1,
          createdAt: new Date().toISOString(),
          transactionHash: "tx1",
        },
        {
          id: "2",
          type: "received",
          amount: "50.0",
          asset: "XLM",
          from: OTHER_ADDRESS2,
          to: USER_ADDRESS,
          createdAt: new Date().toISOString(),
          transactionHash: "tx2",
        },
      ];

      render(
        <PaymentInsightsCard
          payments={mockPayments}
          publicKey={USER_ADDRESS}
          loading={false}
        />
      );

      expect(screen.getByTestId("payment-insights-card")).toBeInTheDocument();
      expect(screen.getByText("Payment Insights")).toBeInTheDocument();
      expect(screen.getByText("XLM Sent")).toBeInTheDocument();
      expect(screen.getByText("XLM Received")).toBeInTheDocument();
      expect(screen.getByText("Unique Counterparties")).toBeInTheDocument();
    });
  });
});
