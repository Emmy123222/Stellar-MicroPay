/**
 * __tests__/useToast.test.ts
 * Unit tests for useToast hook (#524)
 */

import { renderHook, act } from '@testing-library/react';

import * as ToastContext from '../lib/ToastContext';
import { useToast } from '../lib/useToast';

jest.mock('../lib/ToastContext', () => ({
  useToastContext: jest.fn(),
}));

const mockUseToastContext = ToastContext.useToastContext as jest.MockedFunction<typeof ToastContext.useToastContext>;

describe('useToast hook', () => {
  let mockAddToast: jest.Mock;

  beforeEach(() => {
    mockAddToast = jest.fn();
    mockUseToastContext.mockReturnValue({
      toasts: [],
      addToast: mockAddToast,
      removeToast: jest.fn(),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Hook exposes show/dismiss functions', () => {
    it('exposes showToast function', () => {
      const { result } = renderHook(() => useToast());

      expect(result.current.showToast).toBeDefined();
      expect(typeof result.current.showToast).toBe('function');
    });

    it('showToast function has correct signature', () => {
      const { result } = renderHook(() => useToast());

      // Should accept message only
      expect(() => {
        act(() => {
          result.current.showToast('Test message');
        });
      }).not.toThrow();

      // Should accept message and type
      expect(() => {
        act(() => {
          result.current.showToast('Test message', 'success');
        });
      }).not.toThrow();
    });
  });

  describe('Calling show() surfaces a toast via the context', () => {
    it('calls addToast from context with correct parameters', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Test message');
      });

      expect(mockAddToast).toHaveBeenCalledWith('Test message', 'info');
      expect(mockAddToast).toHaveBeenCalledTimes(1);
    });

    it('calls addToast with success type', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Success message', 'success');
      });

      expect(mockAddToast).toHaveBeenCalledWith('Success message', 'success');
    });

    it('calls addToast with error type', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Error message', 'error');
      });

      expect(mockAddToast).toHaveBeenCalledWith('Error message', 'error');
    });

    it('defaults to info type when type is not provided', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Info message');
      });

      expect(mockAddToast).toHaveBeenCalledWith('Info message', 'info');
    });

    it('calls addToast multiple times for multiple toasts', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('First message', 'info');
        result.current.showToast('Second message', 'success');
        result.current.showToast('Third message', 'error');
      });

      expect(mockAddToast).toHaveBeenCalledTimes(3);
      expect(mockAddToast).toHaveBeenNthCalledWith(1, 'First message', 'info');
      expect(mockAddToast).toHaveBeenNthCalledWith(2, 'Second message', 'success');
      expect(mockAddToast).toHaveBeenNthCalledWith(3, 'Third message', 'error');
    });
  });

  describe('Integration with ToastContext', () => {
    it('correctly wraps useToastContext', () => {
      renderHook(() => useToast());

      expect(mockUseToastContext).toHaveBeenCalled();
    });

    it('uses addToast from the context', () => {
      const customAddToast = jest.fn();
      mockUseToastContext.mockReturnValue({
        toasts: [],
        addToast: customAddToast,
        removeToast: jest.fn(),
      });

      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Custom context test');
      });

      expect(customAddToast).toHaveBeenCalledWith('Custom context test', 'info');
      expect(mockAddToast).not.toHaveBeenCalled();
    });
  });

  describe('Backward compatibility', () => {
    it('maintains the original showToast API', () => {
      const { result } = renderHook(() => useToast());

      // Original API: showToast(msg, type)
      act(() => {
        result.current.showToast('Message', 'success');
      });

      expect(mockAddToast).toHaveBeenCalledWith('Message', 'success');
    });

    it('works with legacy code that only passes message', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Legacy message');
      });

      expect(mockAddToast).toHaveBeenCalledWith('Legacy message', 'info');
    });
  });
});
