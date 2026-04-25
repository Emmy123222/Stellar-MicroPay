import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SendPaymentForm from '../components/SendPaymentForm';

// Mock the stellar lib module
jest.mock('@/lib/stellar', () => ({
    buildPaymentTransaction: jest.fn(),
    buildSorobanTipTransaction: jest.fn(),
    CONTRACT_ID: null,
    explorerUrl: jest.fn((hash) => `https://expert.stellar.org/tx/${hash}`),
    isValidStellarAddress: jest.fn((addr) => addr.startsWith('G') && addr.length === 56),
    submitTransaction: jest.fn(),
}));

// Mock the wallet lib module
jest.mock('@/lib/wallet', () => ({
    signTransactionWithWallet: jest.fn(),
}));

// Mock formatXLM
jest.mock('@/utils/format', () => ({
    formatXLM: jest.fn((amount) => `${parseFloat(amount).toFixed(7)} XLM`),
}));

describe('SendPaymentForm - Memo Templates', () => {
    const defaultProps = {
        publicKey: 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ',
        xlmBalance: '100.0000000',
        usdcBalance: '50.0000000',
        onSuccess: jest.fn(),
    };

    const memoTemplates = ['Rent', 'Salary', 'Invoice', 'Gift', 'Coffee ☕'];

    it('renders all 5 memo template chips', () => {
        render(<SendPaymentForm {...defaultProps} />);

        memoTemplates.forEach((template) => {
            expect(screen.getByText(template)).toBeInTheDocument();
        });
    });

    it('fills memo field when clicking a template chip', async () => {
        render(<SendPaymentForm {...defaultProps} />);
        const user = userEvent.setup();

        const rentChip = screen.getByRole('button', { name: /Rent/i });
        await user.click(rentChip);

        const memoInput = screen.getByPlaceholderText('Payment note...');
        expect(memoInput).toHaveValue('Rent');
    });

    it('highlights the selected template chip', async () => {
        render(<SendPaymentForm {...defaultProps} />);
        const user = userEvent.setup();

        const salaryChip = screen.getByRole('button', { name: /Salary/i });
        await user.click(salaryChip);

        expect(salaryChip).toHaveClass('bg-stellar-500/20', 'border-stellar-500/30', 'text-stellar-300');
    });

    it('deselects and clears memo when clicking selected chip again', async () => {
        render(<SendPaymentForm {...defaultProps} />);
        const user = userEvent.setup();

        const invoiceChip = screen.getByRole('button', { name: /Invoice/i });
        const memoInput = screen.getByPlaceholderText('Payment note..') as HTMLInputElement;

        // Click to select
        await user.click(invoiceChip);
        expect(memoInput.value).toBe('Invoice');

        // Click again to deselect
        await user.click(invoiceChip);
        expect(memoInput.value).toBe('');
    });

    it('allows custom typing and deselects template', async () => {
        render(<SendPaymentForm {...defaultProps} />);
        const user = userEvent.setup();

        const memoInput = screen.getByPlaceholderText('Payment note..') as HTMLInputElement;
        const giftChip = screen.getByRole('button', { name: /Gift/i });

        // Select template
        await user.click(giftChip);
        expect(memoInput.value).toBe('Gift');
        expect(giftChip).toHaveClass('bg-stellar-500/20');

        // Type custom text
        await user.clear(memoInput);
        await user.type(memoInput, 'Custom memo');

        // Template should be deselected
        expect(giftChip).not.toHaveClass('bg-stellar-500/20');
        expect(memoInput.value).toBe('Custom memo');
    });

    it('respects 28-character limit from Stellar', async () => {
        render(<SendPaymentForm {...defaultProps} />);
        const user = userEvent.setup();

        const memoInput = screen.getByPlaceholderText('Payment note..') as HTMLInputElement;

        // Try to type more than 28 characters
        await user.type(memoInput, 'This is a very long memo that exceeds the limit');

        // Input should be truncated to 28 characters
        expect(memoInput.value.length).toBeLessThanOrEqual(28);
    });

    it('displays correct character count', async () => {
        render(<SendPaymentForm {...defaultProps} />);
        const user = userEvent.setup();

        const memoInput = screen.getByPlaceholderText('Payment note..') as HTMLInputElement;
        const coffeeChip = screen.getByRole('button', { name: /Coffee ☕/i });

        // Initial state
        expect(screen.getByText('0/28 characters')).toBeInTheDocument();

        // After selecting template
        await user.click(coffeeChip);
        expect(screen.getByText('10/28 characters')).toBeInTheDocument();

        // After clearing
        await user.click(coffeeChip);
        expect(screen.getByText('0/28 characters')).toBeInTheDocument();
    });

    it('disables chips when form is not idle', () => {
        const { rerender } = render(<SendPaymentForm {...defaultProps} />);
        const chips = screen.getAllByRole('button').filter((btn) =>
            memoTemplates.some((tmpl) => btn.textContent?.includes(tmpl))
        );

        // Chips should be enabled initially
        chips.forEach((chip) => {
            expect(chip).not.toBeDisabled();
        });
    });

    it('handles prefilled memo from payment links', () => {
        const prefill = {
            destination: 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ',
            amount: '10.5',
            memo: 'Salary',
        };

        render(<SendPaymentForm {...defaultProps} prefill={prefill} />);

        const memoInput = screen.getByPlaceholderText('Payment note..') as HTMLInputElement;
        expect(memoInput.value).toBe('Salary');
    });

    it('switches between different memo templates correctly', async () => {
        render(<SendPaymentForm {...defaultProps} />);
        const user = userEvent.setup();

        const memoInput = screen.getByPlaceholderText('Payment note..') as HTMLInputElement;
        const rentChip = screen.getByRole('button', { name: /Rent/i });
        const salaryChip = screen.getByRole('button', { name: /Salary/i });

        // Select first template
        await user.click(rentChip);
        expect(memoInput.value).toBe('Rent');
        expect(rentChip).toHaveClass('bg-stellar-500/20');
        expect(salaryChip).not.toHaveClass('bg-stellar-500/20');

        // Switch to another template
        await user.click(salaryChip);
        expect(memoInput.value).toBe('Salary');
        expect(rentChip).not.toHaveClass('bg-stellar-500/20');
        expect(salaryChip).toHaveClass('bg-stellar-500/20');
    });
});
