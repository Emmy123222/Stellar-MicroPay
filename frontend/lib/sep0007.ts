/**
 * lib/sep0007.ts
 * Utilities for parsing SEP-0007 Stellar URIs
 * Implements support for stellar:pay and web+stellar:pay schemes
 */

export interface ParsedStellarURI {
  destination: string;
  amount?: string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  memoType?: 'MEMO_TEXT' | 'MEMO_ID' | 'MEMO_HASH' | 'MEMO_RETURN';
  msg?: string;
  networkPassphrase?: string;
  originDomain?: string;
  signature?: string;
  callback?: string;
}

export interface URIParseResult {
  success: boolean;
  data?: ParsedStellarURI;
  error?: string;
  isExternal?: boolean; // Whether this came from an external URI handler
}

/**
 * Parse a SEP-0007 URI string
 * Supports both stellar:pay and web+stellar:pay formats
 */
export function parseStellarURI(uri: string): URIParseResult {
  try {
    // Handle both stellar:pay and web+stellar:pay
    const stellarRegex = /^(?:web\+)?stellar:pay\?(.+)$/;
    const match = uri.match(stellarRegex);
    
    if (!match) {
      return {
        success: false,
        error: 'Invalid Stellar URI format. Expected stellar:pay or web+stellar:pay'
      };
    }

    const queryString = match[1];
    const params = new URLSearchParams(queryString);
    
    // Extract required parameters
    const destination = params.get('destination');
    if (!destination) {
      return {
        success: false,
        error: 'Missing required parameter: destination'
      };
    }

    // Validate destination format (basic check for Stellar address)
    if (!destination.startsWith('G') || destination.length !== 56) {
      return {
        success: false,
        error: 'Invalid destination address format'
      };
    }

    // Extract optional parameters
    const amount = params.get('amount') || undefined;
    const assetCode = params.get('asset_code') || undefined;
    const assetIssuer = params.get('asset_issuer') || undefined;
    const memo = params.get('memo') || undefined;
    const memoType = params.get('memo_type') as any || undefined;
    const msg = params.get('msg') || undefined;
    const networkPassphrase = params.get('network_passphrase') || undefined;
    const originDomain = params.get('origin_domain') || undefined;
    const signature = params.get('signature') || undefined;
    const callback = params.get('callback') || undefined;

    // Validate memo type if memo is present
    if (memo && memoType && !['MEMO_TEXT', 'MEMO_ID', 'MEMO_HASH', 'MEMO_RETURN'].includes(memoType)) {
      return {
        success: false,
        error: 'Invalid memo_type. Must be one of: MEMO_TEXT, MEMO_ID, MEMO_HASH, MEMO_RETURN'
      };
    }

    // Validate amount if present
    if (amount) {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return {
          success: false,
          error: 'Invalid amount. Must be a positive number'
        };
      }
    }

    // Validate asset issuer if asset code is present but not XLM
    if (assetCode && assetCode !== 'XLM' && !assetIssuer) {
      return {
        success: false,
        error: 'asset_issuer is required when asset_code is not XLM'
      };
    }

    const result: ParsedStellarURI = {
      destination,
      amount,
      assetCode,
      assetIssuer,
      memo,
      memoType,
      msg,
      networkPassphrase,
      originDomain,
      signature,
      callback
    };

    return {
      success: true,
      data: result,
      isExternal: uri.startsWith('web+stellar:')
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse URI'
    };
  }
}

/**
 * Get Stellar URI from current page URL if present
 */
export function getStellarURIFromURL(): URIParseResult | null {
  if (typeof window === 'undefined') return null;
  
  const urlParams = new URLSearchParams(window.location.search);
  const stellarURI = urlParams.get('uri');
  
  if (!stellarURI) return null;
  
  return parseStellarURI(stellarURI);
}

/**
 * Register the protocol handler for web+stellar: links
 * Should be called on app initialization
 */
export function registerProtocolHandler(): void {
  if (typeof window === 'undefined') return;
  
  try {
    // Register for web+stellar: protocol
    navigator.registerProtocolHandler('web+stellar', `${window.location.origin}?uri=%s`);
    console.log('Successfully registered web+stellar: protocol handler');
  } catch (error) {
    console.warn('Failed to register protocol handler:', error);
    // This is expected in some browsers/environments
  }
}

/**
 * Convert parsed URI to prefill data for SendPaymentForm
 */
export function uriToPrefillData(parsed: ParsedStellarURI) {
  return {
    destination: parsed.destination,
    amount: parsed.amount || '',
    memo: parsed.memo || ''
  };
}
