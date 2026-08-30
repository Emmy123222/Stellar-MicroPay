/** Stable contracts shared by Stellar domain helpers and UI consumers. */

export enum TransactionCategory {
  Payment = "Payment",
  Transfer = "Transfer",
  Merge = "Merge",
}

export interface WalletBalance {
  asset: string;
  balance: string;
  assetCode: string;
}

export interface Trustline {
  assetCode: string;
  issuer: string;
  balance: string;
  limit: string;
}

export interface PaymentRecord {
  id: string;
  type: "sent" | "received" | "merge";
  amount: string;
  asset: string;
  from: string;
  to: string;
  memo?: string;
  createdAt: string;
  transactionHash: string;
  pagingToken?: string;
  category?: TransactionCategory;
}

export interface PaymentHistoryResponse {
  records: PaymentRecord[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface FetchAllPaymentsProgress {
  fetchedRecords: number;
  fetchedPages: number;
  done: boolean;
}

export type PaymentStreamHandler = (payment: PaymentRecord) => void;
export type PaymentStreamUnsubscribe = () => void;

export interface FundingPollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export interface AccountReserveInfo {
  xlmBalance: number;
  subentryCount: number;
  minimumBalance: number;
  spendableBalance: number;
}
