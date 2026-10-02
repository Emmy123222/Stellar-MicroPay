import { parseStellarURI, uriToPrefillData } from '../lib/sep0007';

const VALID_DESTINATION = 'GB5XVAABEQMY63WTHDQ5RXADGYF345VWMNPTN2GFUDZT57D57ZQTJ7PS';

describe('parseStellarURI', () => {
  it('parses the single-slash web+stellar:pay form', () => {
    const result = parseStellarURI(`web+stellar:pay?destination=${VALID_DESTINATION}&amount=10`);

    expect(result.success).toBe(true);
    expect(result.data?.destination).toBe(VALID_DESTINATION);
    expect(result.data?.amount).toBe('10');
  });

  it('parses the double-slash web+stellar://pay variant some wallets emit', () => {
    const result = parseStellarURI(`web+stellar://pay?destination=${VALID_DESTINATION}&amount=10`);

    expect(result.success).toBe(true);
    expect(result.data?.destination).toBe(VALID_DESTINATION);
    expect(result.data?.amount).toBe('10');
  });

  it('still parses the bare stellar:pay form', () => {
    const result = parseStellarURI(`stellar:pay?destination=${VALID_DESTINATION}`);

    expect(result.success).toBe(true);
    expect(result.data?.destination).toBe(VALID_DESTINATION);
  });

  it('rejects a malformed scheme', () => {
    const result = parseStellarURI(`https://example.com?destination=${VALID_DESTINATION}`);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid Stellar URI format/);
  });
});

describe('uriToPrefillData', () => {
  it('maps a parsed URI to prefill fields', () => {
    const prefill = uriToPrefillData({ destination: VALID_DESTINATION, amount: '5', memo: 'hi' });

    expect(prefill).toEqual({ destination: VALID_DESTINATION, amount: '5', memo: 'hi' });
  });
});
