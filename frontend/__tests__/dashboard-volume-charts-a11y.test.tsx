import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  BalanceSparkline,
  MonthlySpendingChart,
  ThirtyDayVolumeChart,
} from "@/components/dashboard";

describe("dashboard volume chart accessibility", () => {
  it("summarizes a sparkline, hides its drawing nodes, and discloses values", () => {
    const { container } = render(<BalanceSparkline data={[2, -1, 5]} />);

    expect(
      screen.getByText(/upward trend: \+3\.0000 XLM across 3 recent payments/i)
    ).toBeInTheDocument();
    expect(container.querySelector("path")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("polyline")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByText("View balance trend data"));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Payment" })).toBeInTheDocument();
    expect(within(table).getByText("-1.0000 XLM")).toBeInTheDocument();
  });

  it("summarizes monthly spending and discloses a data table", () => {
    const { container } = render(
      <MonthlySpendingChart
        loading={false}
        onBarClick={jest.fn()}
        data={[
          { month: "Jul", label: "July 2026", sent: 2, received: 4 },
          { month: "Aug", label: "August 2026", sent: 5.5, received: 1 },
        ]}
      />
    );

    expect(
      screen.getByText("7.50 XLM sent across 2 months. Highest spending was 5.50 XLM in August 2026.")
    ).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();

    fireEvent.click(screen.getByText("View monthly spending data"));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("rowheader", { name: "July 2026" })).toBeInTheDocument();
    expect(within(table).getByText("5.50 XLM")).toBeInTheDocument();
  });

  it("summarizes 30-day volume and discloses sent and received values", () => {
    render(
      <ThirtyDayVolumeChart
        loading={false}
        data={[
          { day: "Aug 29", sent: 3, received: 1 },
          { day: "Aug 30", sent: 2, received: 8 },
        ]}
      />
    );

    expect(
      screen.getByText("5.00 XLM sent and 9.00 XLM received. Net flow was in 4.00 XLM.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("View 30-day volume data"));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Received" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Aug 30" })).toBeInTheDocument();
  });
});
