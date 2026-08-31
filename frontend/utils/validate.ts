/**
 * utils/validate.ts
 * Centralized validation utilities for Stellar addresses, amounts, and other data.
 * Used across SendPaymentForm, BatchPaymentForm, QuickSendModal, TradeForm, etc.
 */

// Stellar address validation (public key format: G + 55 alphanumeric chars)
export const isValidStellarAddress = (address: string): boolean => {
  return /^G[A-Z2-7]{55}$/.test(address);
};

// Amount validation: non-negative, finite, no scientific notation
export const isValidPaymentAmount = (
  amountStr: string,
  minStroop: number = 1,
  maxAmount: number = Infinity
): boolean => {
  const amountNum = parseFloat(amountStr);
  return (
    Number.isFinite(amountNum) &&
    amountNum >= minStroop &&
    amountNum <= maxAmount &&
    !/[eE]/.test(amountStr) // reject scientific notation
  );
};

// Extract numeric value from amount string (e.g., "50 XLM" -> "50")
export const extractAmountFromString = (amountStr: string): string => {
  const numericAmount = amountStr.replace(/[^\d.]/g, "");
  return numericAmount;
};

// Parse payment amount with currency (e.g., "50 XLM" -> { amount: "50", currency: "XLM" })
export const parsePaymentAmount = (input: string): { amount: string; currency: string } => {
  const match = input.match(/(\d+(?:\.\d+)?)\s*(XLM|USDC|USD)/i);
  if (match) {
    return {
      amount: match[1],
      currency: match[2].toUpperCase(),
    };
  }
  return { amount: "", currency: "" };
};

// Validate a Stellar address or federation address format
export const validateStellarDestination = (
  destination: string
): { valid: boolean; error?: string } => {
  if (!destination) {
    return { valid: false, error: "Destination is required" };
  }

  // Check for Stellar public key
  if (isValidStellarAddress(destination)) {
    return { valid: true };
  }

  // Check for federation address (user*domain.com format)
  if (/^[a-zA-Z0-9._-]+\*[a-zA-Z0-9.-]+$/.test(destination)) {
    return { valid: true };
  }

  // Check for username (alphanumeric + underscore)
  if (/^[a-zA-Z0-9_]+$/.test(destination)) {
    return { valid: true };
  }

  return { valid: false, error: "Invalid Stellar address, federation address, or username" };
};
