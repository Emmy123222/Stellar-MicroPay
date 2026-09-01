/**
 * __tests__/ToastContext.test.tsx
 * Unit tests for ToastContext provider (#521)
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToastProvider, useToastContext } from '../lib/ToastContext';

// Test component that uses the toast context
function ToastConsumer({ testId }: { testId: string }) {
  const { toasts, addToast, removeToast } = useToastContext();

  return (
    <div data-testid={testId}>
      <button onClick={() => addToast('Test message', 'info')}>Add Toast</button>
      <button onClick={() => addToast('Success message', 'success')}>Add Success</button>
      <button onClick={() => addToast('Error message', 'error')}>Add Error</button>
      {toasts.map((toast) => (
        <div key={toast.id} data-testid={`toast-${toast.id}`}>
          <span>{toast.message}</span>
          <span>{toast.type}</span>
          <button onClick={() => removeToast(toast.id)}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}

describe('ToastContext', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('show() adds a toast to context state', () => {
    it('adds a toast to the state when addToast is called', () => {
      render(
        <ToastProvider>
          <ToastConsumer testId="consumer" />
        </ToastProvider>
      );

      const addButton = screen.getByText('Add Toast');
      act(() => {
        addButton.click();
      });

      expect(screen.getByText('Test message')).toBeInTheDocument();
      expect(screen.getByText('info')).toBeInTheDocument();
    });

    it('adds multiple toasts to the state', () => {
      render(
        <ToastProvider>
          <ToastConsumer testId="consumer" />
        </ToastProvider>
      );

      act(() => {
        screen.getByText('Add Toast').click();
        screen.getByText('Add Success').click();
        screen.getByText('Add Error').click();
      });

      expect(screen.getByText('Test message')).toBeInTheDocument();
      expect(screen.getByText('Success message')).toBeInTheDocument();
      expect(screen.getByText('Error message')).toBeInTheDocument();
    });

    it('creates toasts with different types', () => {
      render(
        <ToastProvider>
          <ToastConsumer testId="consumer" />
        </ToastProvider>
      );

      act(() => {
        screen.getByText('Add Success').click();
      });

      expect(screen.getByText('Success message')).toBeInTheDocument();
      expect(screen.getByText('success')).toBeInTheDocument();
    });

    it('auto-dismisses toast after default duration', async () => {
      render(
        <ToastProvider>
          <ToastConsumer testId="consumer" />
        </ToastProvider>
      );

      act(() => {
        screen.getByText('Add Toast').click();
      });

      expect(screen.getByText('Test message')).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(4000);
      });

      await waitFor(() => {
        expect(screen.queryByText('Test message')).not.toBeInTheDocument();
      });
    });
  });

  describe('dismiss(id) removes only the targeted toast', () => {
    it('removes a specific toast when dismiss is called', () => {
      render(
        <ToastProvider>
          <ToastConsumer testId="consumer" />
        </ToastProvider>
      );

      act(() => {
        screen.getByText('Add Toast').click();
        screen.getByText('Add Success').click();
      });

      const toasts = screen.getAllByText('Dismiss');
      expect(toasts).toHaveLength(2);

      act(() => {
        toasts[0].click();
      });

      expect(screen.queryByText('Test message')).not.toBeInTheDocument();
      expect(screen.getByText('Success message')).toBeInTheDocument();
    });

    it('removes only the targeted toast among multiple toasts', () => {
      render(
        <ToastProvider>
          <ToastConsumer testId="consumer" />
        </ToastProvider>
      );

      act(() => {
        screen.getByText('Add Toast').click();
        screen.getByText('Add Success').click();
        screen.getByText('Add Error').click();
      });

      expect(screen.getByText('Test message')).toBeInTheDocument();
      expect(screen.getByText('Success message')).toBeInTheDocument();
      expect(screen.getByText('Error message')).toBeInTheDocument();

      const dismissButtons = screen.getAllByText('Dismiss');
      act(() => {
        dismissButtons[1].click(); // Remove second toast
      });

      expect(screen.getByText('Test message')).toBeInTheDocument();
      expect(screen.queryByText('Success message')).not.toBeInTheDocument();
      expect(screen.getByText('Error message')).toBeInTheDocument();
    });
  });

  describe('Multiple consumers observe the same toast list', () => {
    it('synchronizes toast state across multiple consumers', () => {
      render(
        <ToastProvider>
          <ToastConsumer testId="consumer1" />
          <ToastConsumer testId="consumer2" />
        </ToastProvider>
      );

      const consumer1 = screen.getByTestId('consumer1');
      const consumer2 = screen.getByTestId('consumer2');

      const addButton1 = consumer1.querySelector('button') as HTMLButtonElement;
      
      act(() => {
        addButton1.click();
      });

      // Both consumers should see the same toast
      const messages = screen.getAllByText('Test message');
      expect(messages).toHaveLength(2);
    });

    it('updates all consumers when a toast is dismissed', () => {
      render(
        <ToastProvider>
          <ToastConsumer testId="consumer1" />
          <ToastConsumer testId="consumer2" />
        </ToastProvider>
      );

      const consumer1 = screen.getByTestId('consumer1');
      const addButton = consumer1.querySelector('button') as HTMLButtonElement;

      act(() => {
        addButton.click();
      });

      expect(screen.getAllByText('Test message')).toHaveLength(2);

      const dismissButtons = screen.getAllByText('Dismiss');
      act(() => {
        dismissButtons[0].click();
      });

      expect(screen.queryByText('Test message')).not.toBeInTheDocument();
    });

    it('shows new toasts to all consumers', () => {
      render(
        <ToastProvider>
          <ToastConsumer testId="consumer1" />
          <ToastConsumer testId="consumer2" />
        </ToastProvider>
      );

      const consumer2 = screen.getByTestId('consumer2');
      const buttons = consumer2.querySelectorAll('button');
      const addSuccessButton = Array.from(buttons).find(
        (btn) => btn.textContent === 'Add Success'
      ) as HTMLButtonElement;

      act(() => {
        addSuccessButton.click();
      });

      // Both consumers should see the toast added by consumer2
      expect(screen.getAllByText('Success message')).toHaveLength(2);
    });
  });

  describe('NOOP context handling', () => {
    it('provides NOOP context when used outside provider', () => {
      const { container } = render(<ToastConsumer testId="orphan" />);

      const addButton = screen.getByText('Add Toast');
      act(() => {
        addButton.click();
      });

      // Should not throw and should not render any toast
      expect(screen.queryByText('Test message')).not.toBeInTheDocument();
    });
  });
});
