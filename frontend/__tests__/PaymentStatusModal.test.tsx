import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import PaymentStatusModal, { PaymentFlowStatus, PaymentStepId, PaymentStepTiming } from '../components/PaymentStatusModal';

const createStepTimings = (overrides: Partial<Record<PaymentStepId, PaymentStepTiming>> = {}): Record<PaymentStepId, PaymentStepTiming> => {
  const defaultTiming: PaymentStepTiming = { startedAt: null, completedAt: null, error: null };
  const steps: PaymentStepId[] = ['building', 'signing', 'submitting', 'confirming'];
  return steps.reduce((acc, step) => {
    acc[step] = overrides[step] ?? defaultTiming;
    return acc;
  }, {} as Record<PaymentStepId, PaymentStepTiming>);
};

// Fixed timestamp for consistent snapshots
const FIXED_NOW = 1700000000000;
const ORIGINAL_TIME_ZONE = process.env.TZ;

describe('PaymentStatusModal snapshot tests', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });

  afterAll(() => {
    if (ORIGINAL_TIME_ZONE === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TIME_ZONE;
    }
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    txHash: null,
    error: null,
    failedStep: null,
    stepTimings: createStepTimings(),
    explorerHref: null,
    timeoutSeconds: 60,
  };

  it('renders pending state (building)', () => {
    const { container } = render(
      <PaymentStatusModal
        {...defaultProps}
        status="building"
        stepTimings={createStepTimings({ building: { startedAt: FIXED_NOW - 2000, completedAt: null, error: null } })}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders pending state (signing)', () => {
    const { container } = render(
      <PaymentStatusModal
        {...defaultProps}
        status="signing"
        stepTimings={createStepTimings({
          building: { startedAt: FIXED_NOW - 10000, completedAt: FIXED_NOW - 8000, error: null },
          signing: { startedAt: FIXED_NOW - 8000, completedAt: null, error: null },
        })}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders pending state (submitting)', () => {
    const { container } = render(
      <PaymentStatusModal
        {...defaultProps}
        status="submitting"
        stepTimings={createStepTimings({
          building: { startedAt: FIXED_NOW - 20000, completedAt: FIXED_NOW - 18000, error: null },
          signing: { startedAt: FIXED_NOW - 18000, completedAt: FIXED_NOW - 16000, error: null },
          submitting: { startedAt: FIXED_NOW - 16000, completedAt: null, error: null },
        })}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders pending state (confirming)', () => {
    const { container } = render(
      <PaymentStatusModal
        {...defaultProps}
        status="confirming"
        stepTimings={createStepTimings({
          building: { startedAt: FIXED_NOW - 30000, completedAt: FIXED_NOW - 28000, error: null },
          signing: { startedAt: FIXED_NOW - 28000, completedAt: FIXED_NOW - 26000, error: null },
          submitting: { startedAt: FIXED_NOW - 26000, completedAt: FIXED_NOW - 24000, error: null },
          confirming: { startedAt: FIXED_NOW - 24000, completedAt: null, error: null },
        })}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders success state', () => {
    const { container } = render(
      <PaymentStatusModal
        {...defaultProps}
        status="success"
        txHash="abc123def456"
        explorerHref="https://stellar.expert/explorer/public/tx/abc123def456"
        stepTimings={createStepTimings({
          building: { startedAt: FIXED_NOW - 40000, completedAt: FIXED_NOW - 38000, error: null },
          signing: { startedAt: FIXED_NOW - 38000, completedAt: FIXED_NOW - 36000, error: null },
          submitting: { startedAt: FIXED_NOW - 36000, completedAt: FIXED_NOW - 34000, error: null },
          confirming: { startedAt: FIXED_NOW - 34000, completedAt: FIXED_NOW - 32000, error: null },
        })}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders failure state with error', () => {
    const { container } = render(
      <PaymentStatusModal
        {...defaultProps}
        status="error"
        error="Transaction failed: Insufficient balance"
        failedStep="submitting"
        stepTimings={createStepTimings({
          building: { startedAt: FIXED_NOW - 40000, completedAt: FIXED_NOW - 38000, error: null },
          signing: { startedAt: FIXED_NOW - 38000, completedAt: FIXED_NOW - 36000, error: null },
          submitting: { startedAt: FIXED_NOW - 36000, completedAt: null, error: 'Insufficient balance' },
        })}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders failure state with generic error (no step error)', () => {
    const { container } = render(
      <PaymentStatusModal
        {...defaultProps}
        status="error"
        error="Network connection lost"
        failedStep="building"
        stepTimings={createStepTimings({
          building: { startedAt: FIXED_NOW - 10000, completedAt: null, error: null },
        })}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders idle state', () => {
    const { container } = render(
      <PaymentStatusModal
        {...defaultProps}
        status="idle"
        stepTimings={createStepTimings()}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders closed state (isOpen=false)', () => {
    const { container } = render(
      <PaymentStatusModal
        {...defaultProps}
        isOpen={false}
        status="idle"
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});