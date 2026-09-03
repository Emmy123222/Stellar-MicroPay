/**
 * utils/validate.ts
 * Validation utilities for Stellar addresses and other data
 */

export const isValidStellarAddress = (address: string): boolean => {
  return /^G[A-Z2-7]{55}$/.test(address);
};

export const extractAmountFromString = (amountStr: string): string => {
  // Extract numeric value from amount string (e.g., "50 XLM" -> "50")
  const numericAmount = amountStr.replace(/[^\d.]/g, '');
  return numericAmount;
};

export const parsePaymentAmount = (input: string): { amount: string; currency: string } => {
  const match = input.match(/(\d+(?:\.\d+)?)\s*(XLM|USDC|USD)/i);
  if (match) {
    return {
      amount: match[1],
      currency: match[2].toUpperCase()
    };
  }
  return { amount: '', currency: '' };
};