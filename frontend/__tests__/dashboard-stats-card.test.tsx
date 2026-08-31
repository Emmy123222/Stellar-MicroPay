import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StatsCard, formatStatsXLM } from "@/components/dashboard/StatsCard";

describe("StatsCard", () => {
  it("renders label, value, and helper text", () => {
    render(<StatsCard label="Total Sent" value="100.00 XLM sent" helper="5 payments" />);
    expect(screen.getByText("Total Sent")).toBeInTheDocument();
    expect(screen.getByText("100.00 XLM sent")).toBeInTheDocument();
    expect(screen.getByText("5 payments")).toBeInTheDocument();
  });

  it("renders positive delta with green styling", () => {
    render(<StatsCard label="Test" value="100" helper="helper" delta={10} deltaType="positive" />);
    expect(screen.getByText("+10%")).toBeInTheDocument();
  });

  it("renders negative delta with red styling", () => {
    render(<StatsCard label="Test" value="100" helper="helper" delta={-5} deltaType="negative" />);
    expect(screen.getByText("-5%")).toBeInTheDocument();
  });

  it("does not render delta when not provided", () => {
    render(<StatsCard label="Test" value="100" helper="helper" />);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});

describe("formatStatsXLM", () => {
  it("formats a valid amount with default suffix", () => {
    expect(formatStatsXLM("100.5")).toBe("100.50 XLM sent");
  });

  it("formats a valid amount with custom suffix", () => {
    expect(formatStatsXLM("50.25", "received")).toBe("50.25 XLM received");
  });

  it("returns fallback for NaN input", () => {
    expect(formatStatsXLM("invalid")).toBe("0.00 XLM sent");
  });

  it("formats large numbers with locale separators", () => {
    expect(formatStatsXLM("1234567.89")).toBe("1,234,567.89 XLM sent");
  });
});
