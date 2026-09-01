/**
 * __tests__/sep0007.test.ts
 * Unit tests for SEP-0007 Stellar URI parsing and generation (#519)
 */

import { parseStellarURI, uriToPrefillData, type ParsedStellarURI } from '../lib/sep0007';

describe('sep0007 URI parsing', () => {
  describe('Generates valid SEP-0007 URIs', () => {
    it('parses a basic stellar:pay URI with destination', () => {
      const uri = 'stellar:pay?destination=GABC123456789012345678901234567890123456789012345678';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(true);
      expect(result.data?.destination).toBe('GABC123456789012345678901234567890123456789012345678');
    });

    it('parses a URI with destination, amount, and memo', () => {
      const uri = 'stellar:pay?destination=GABC123456789012345678901234567890123456789012345678&amount=100&memo=TestPayment';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(true);
      expect(result.data?.destination).toBe('GABC123456789012345678901234567890123456789012345678');
      expect(result.data?.amount).toBe('100');
      expect(result.data?.memo).toBe('TestPayment');
    });

    it('parses a web+stellar:pay URI', () => {
      const uri = 'web+stellar:pay?destination=GABC123456789012345678901234567890123456789012345678&amount=50';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(true);
      expect(result.isExternal).toBe(true);
      expect(result.data?.destination).toBe('GABC123456789012345678901234567890123456789012345678');
      expect(result.data?.amount).toBe('50');
    });

    it('parses stellarmicropay:// deep link with to parameter', () => {
      const uri = 'stellarmicropay://pay?to=GABC123456789012345678901234567890123456789012345678&amount=25';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(true);
      expect(result.data?.destination).toBe('GABC123456789012345678901234567890123456789012345678');
      expect(result.data?.amount).toBe('25');
    });
  });

  describe('Parses valid URI back into operation params', () => {
    it('extracts all optional parameters correctly', () => {
      const uri = 'stellar:pay?destination=GABC123456789012345678901234567890123456789012345678&amount=100&asset_code=USDC&asset_issuer=GDEF456789012345678901234567890123456789012345678901&memo=Invoice123&memo_type=MEMO_TEXT&msg=Payment%20for%20services';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(true);
      expect(result.data?.destination).toBe('GABC123456789012345678901234567890123456789012345678');
      expect(result.data?.amount).toBe('100');
      expect(result.data?.assetCode).toBe('USDC');
      expect(result.data?.assetIssuer).toBe('GDEF456789012345678901234567890123456789012345678901');
      expect(result.data?.memo).toBe('Invoice123');
      expect(result.data?.memoType).toBe('MEMO_TEXT');
      expect(result.data?.msg).toBe('Payment for services');
    });

    it('converts parsed URI to prefill data', () => {
      const parsed: ParsedStellarURI = {
        destination: 'GABC123456789012345678901234567890123456789012345678',
        amount: '100',
        memo: 'Test'
      };

      const prefillData = uriToPrefillData(parsed);

      expect(prefillData.destination).toBe('GABC123456789012345678901234567890123456789012345678');
      expect(prefillData.amount).toBe('100');
      expect(prefillData.memo).toBe('Test');
    });
  });

  describe('Rejects malformed or unsupported URIs', () => {
    it('rejects MEMO_TEXT values over 28 UTF-8 bytes', () => {
      const memo = encodeURIComponent('😀'.repeat(8));
      const result = parseStellarURI(`stellar:pay?destination=GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234&memo_type=MEMO_TEXT&memo=${memo}`);

      expect(result.success).toBe(false);
      expect(result.error).toContain('28-byte UTF-8 limit');
    });

    it('counts combining marks by encoded byte length', () => {
      const memo = encodeURIComponent('e\u0301'.repeat(14));
      const result = parseStellarURI(`stellar:pay?destination=GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234&memo_type=MEMO_TEXT&memo=${memo}`);

      expect(result.success).toBe(false);
      expect(result.error).toContain('28-byte UTF-8 limit');
    });

    it('rejects URI without stellar: or web+stellar: scheme', () => {
      const uri = 'http://example.com?destination=GABC123456789012345678901234567890123456789012345678';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid Stellar URI format');
    });

    it('rejects URI missing destination parameter', () => {
      const uri = 'stellar:pay?amount=100';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameter: destination');
    });

    it('rejects URI with invalid destination format', () => {
      const uri = 'stellar:pay?destination=INVALID';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid destination address format');
    });

    it('rejects URI with invalid amount', () => {
      const uri = 'stellar:pay?destination=GABC123456789012345678901234567890123456789012345678&amount=-50';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid amount');
    });

    it('rejects URI with non-numeric amount', () => {
      const uri = 'stellar:pay?destination=GABC123456789012345678901234567890123456789012345678&amount=abc';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid amount');
    });

    it('rejects URI with asset_code but missing asset_issuer', () => {
      const uri = 'stellar:pay?destination=GABC123456789012345678901234567890123456789012345678&asset_code=USDC';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(false);
      expect(result.error).toContain('asset_issuer is required');
    });

    it('allows XLM asset_code without asset_issuer', () => {
      const uri = 'stellar:pay?destination=GABC123456789012345678901234567890123456789012345678&asset_code=XLM&amount=100';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(true);
      expect(result.data?.assetCode).toBe('XLM');
      expect(result.data?.assetIssuer).toBeUndefined();
    });

    it('handles malformed query parameters gracefully', () => {
      const uri = 'stellar:pay?destination=GABC123456789012345678901234567890123456789012345678&&&amount=100';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(true);
      expect(result.data?.amount).toBe('100');
    });

    it('rejects URI with asset_issuer but missing asset_code', () => {
      const uri = 'stellar:pay?destination=GABC123456789012345678901234567890123456789012345678&asset_issuer=GDEF456789012345678901234567890123456789012345678901';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(false);
      expect(result.error).toContain('asset_code is required');
    });

    it('rejects unsupported network passphrase', () => {
      const uri = 'stellar:pay?destination=GABC123456789012345678901234567890123456789012345678&network_passphrase=Fake%20Network';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported network passphrase');
    });

    it('allows valid network passphrases', () => {
      const uri = 'stellar:pay?destination=GABC123456789012345678901234567890123456789012345678&network_passphrase=Test%20SDF%20Network%20%3B%20September%202015';
      const result = parseStellarURI(uri);

      expect(result.success).toBe(true);
      expect(result.data?.networkPassphrase).toBe('Test SDF Network ; September 2015');
    });
  });
});
