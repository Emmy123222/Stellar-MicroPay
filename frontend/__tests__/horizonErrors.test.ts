import {
  extractHorizonResultCodes,
  formatHorizonResultCodes,
  parseHorizonSubmissionError,
} from '../lib/horizonErrors';

function horizonError(resultCodes: Record<string, unknown>) {
  return {
    response: {
      data: {
        extras: {
          result_codes: resultCodes,
        },
      },
    },
  };
}

describe('extractHorizonResultCodes', () => {
  it('extracts transaction and operation codes from a Horizon error', () => {
    const err = horizonError({ transaction: 'tx_failed', operations: ['op_underfunded'] });

    expect(extractHorizonResultCodes(err)).toEqual({
      transaction: 'tx_failed',
      operations: ['op_underfunded'],
    });
  });

  it('returns null for a plain Error with no Horizon shape', () => {
    expect(extractHorizonResultCodes(new Error('network down'))).toBeNull();
  });

  it('returns null for a non-object value', () => {
    expect(extractHorizonResultCodes('nope')).toBeNull();
    expect(extractHorizonResultCodes(null)).toBeNull();
    expect(extractHorizonResultCodes(undefined)).toBeNull();
  });
});

describe('formatHorizonResultCodes', () => {
  it('prefers a specific operation code over the generic transaction code', () => {
    const message = formatHorizonResultCodes({
      transaction: 'tx_failed',
      operations: ['op_underfunded'],
    });

    expect(message).toBe('Insufficient balance to complete this payment.');
  });

  it('falls back to the transaction code when there is no actionable operation code', () => {
    const message = formatHorizonResultCodes({ transaction: 'tx_bad_seq' });

    expect(message).toMatch(/out-of-date sequence number/);
  });

  it('skips op_success entries when looking for the actionable operation code', () => {
    const message = formatHorizonResultCodes({
      transaction: 'tx_failed',
      operations: ['op_success', 'op_no_destination'],
    });

    expect(message).toBe('The destination account does not exist on the network.');
  });

  it('falls back to a generic message when no known code matches', () => {
    expect(formatHorizonResultCodes({})).toBe('Transaction failed for an unknown reason.');
  });
});

describe('parseHorizonSubmissionError', () => {
  it('maps a Horizon op_no_destination error to its human-readable message', () => {
    const err = horizonError({ transaction: 'tx_failed', operations: ['op_no_destination'] });

    const result = parseHorizonSubmissionError(err);

    expect(result.message).toBe('The destination account does not exist on the network.');
    expect(result.codes).toEqual({ transaction: 'tx_failed', operations: ['op_no_destination'] });
  });

  it('maps a Horizon tx_bad_seq error with no operation codes', () => {
    const err = horizonError({ transaction: 'tx_bad_seq' });

    const result = parseHorizonSubmissionError(err);

    expect(result.message).toMatch(/out-of-date sequence number/);
    expect(result.codes?.transaction).toBe('tx_bad_seq');
  });

  it('falls back to the error message for a non-Horizon error', () => {
    const result = parseHorizonSubmissionError(new Error('Signing failed'));

    expect(result.message).toBe('Signing failed');
    expect(result.codes).toBeNull();
  });

  it('falls back to a generic message for a value with no message at all', () => {
    const result = parseHorizonSubmissionError({});

    expect(result.message).toBe('An unexpected error occurred');
    expect(result.codes).toBeNull();
  });
});
