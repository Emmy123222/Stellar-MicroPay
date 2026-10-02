import { PaymentRecord } from "@/lib/stellar";

export interface PaymentInsightsData {
  sentThisMonth: number;
  sentLastMonth: number;
  sentChangePercent: number | null;
  receivedThisMonth: number;
  receivedLastMonth: number;
  receivedChangePercent: number | null;
  uniqueCounterpartiesThisMonth: number;
}

export function calculatePaymentInsights(
  payments: PaymentRecord[],
  publicKey: string,
  referenceDate: Date = new Date()
): PaymentInsightsData {
  const currentYear = referenceDate.getFullYear();
  const currentMonth = referenceDate.getMonth();

  const lastMonthDate = new Date(referenceDate);
  lastMonthDate.setMonth(currentMonth - 1);
  const lastYear = lastMonthDate.getFullYear();
  const lastMonth = lastMonthDate.getMonth();

  let sentThisMonth = 0;
  let sentLastMonth = 0;
  let receivedThisMonth = 0;
  let receivedLastMonth = 0;

  const counterpartiesSet = new Set<string>();

  for (const p of payments) {
    if (!p.createdAt) continue;
    const date = new Date(p.createdAt);
    if (isNaN(date.getTime())) continue;

    const year = date.getFullYear();
    const month = date.getMonth();

    const isCurrentMonth = year === currentYear && month === currentMonth;
    const isLastMonth = year === lastYear && month === lastMonth;

    const isXLM = !p.asset || p.asset === "XLM" || p.asset === "native";
    const amount = parseFloat(p.amount) || 0;

    const isSent = p.type === "sent" || (p.from === publicKey && p.to !== publicKey);
    const isReceived = p.type === "received" || (p.to === publicKey && p.from !== publicKey);

    if (isCurrentMonth) {
      if (isXLM) {
        if (isSent) sentThisMonth += amount;
        if (isReceived) receivedThisMonth += amount;
      }

      const counterparty = p.from === publicKey ? p.to : p.from;
      if (counterparty && counterparty !== publicKey) {
        counterpartiesSet.add(counterparty);
      }
    } else if (isLastMonth) {
      if (isXLM) {
        if (isSent) sentLastMonth += amount;
        if (isReceived) receivedLastMonth += amount;
      }
    }
  }

  const calculateChange = (thisMonth: number, lastMonth: number): number | null => {
    if (lastMonth === 0) {
      if (thisMonth === 0) return 0;
      return 100;
    }
    return ((thisMonth - lastMonth) / lastMonth) * 100;
  };

  return {
    sentThisMonth,
    sentLastMonth,
    sentChangePercent: calculateChange(sentThisMonth, sentLastMonth),
    receivedThisMonth,
    receivedLastMonth,
    receivedChangePercent: calculateChange(receivedThisMonth, receivedLastMonth),
    uniqueCounterpartiesThisMonth: counterpartiesSet.size,
  };
}
