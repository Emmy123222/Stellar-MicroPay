/**
 * __tests__/AIPaymentAssistant.test.tsx
 * Tests for the AI Payment Assistant component
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AIPaymentAssistant, { FloatingAssistantButton } from '../components/AIPaymentAssistant';

const mockOnClose = jest.fn();
const mockOnConfirm = jest.fn();

// Builds a Response-like object for mocking the parse-payment API.
const jsonResponse = (body: object, ok = true): Response =>
  ({
    ok,
    json: async () => body,
  }) as Response;

// jsdom does not ship `fetch`; provide a stub so it can be spied on below.
if (typeof global.fetch === 'undefined') {
  Object.defineProperty(global, 'fetch', {
    value: jest.fn(),
    configurable: true,
    writable: true,
  });
}

describe('AIPaymentAssistant', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('renders when open', () => {
    render(
      <AIPaymentAssistant
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    expect(screen.getByText('AI Payment Assistant')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Send 50 XLM to GABC123/)).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(
      <AIPaymentAssistant
        isOpen={false}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    expect(screen.queryByText('AI Payment Assistant')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(
      <AIPaymentAssistant
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    const closeButton = screen.getByLabelText('Close assistant');
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('handles successful payment parsing', async () => {
    const mockResponse = {
      amount: '50 XLM',
      recipient: 'GABC123',
      memo: 'design work',
      isValid: true,
      clarification: ''
    };

    fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));

    render(
      <AIPaymentAssistant
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    const textarea = screen.getByPlaceholderText(/Send 50 XLM to GABC123/);
    const submitButton = screen.getByText('Parse Payment');

    fireEvent.change(textarea, { target: { value: 'Send 50 XLM to GABC123 for design work' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Parsed Payment Details')).toBeInTheDocument();
      expect(screen.getByText('50 XLM')).toBeInTheDocument();
      expect(screen.getByText('GABC123')).toBeInTheDocument();
      expect(screen.getByText('design work')).toBeInTheDocument();
    });
  });

  it('handles invalid payment parsing with clarification', async () => {
    const mockResponse = {
      amount: '',
      recipient: 'Alice',
      memo: 'job',
      isValid: false,
      clarification: 'What amount should be sent?'
    };

    fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));

    render(
      <AIPaymentAssistant
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    const textarea = screen.getByPlaceholderText(/Send 50 XLM to GABC123/);
    const submitButton = screen.getByText('Parse Payment');

    fireEvent.change(textarea, { target: { value: 'Pay Alice for the job' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Need More Information')).toBeInTheDocument();
      expect(screen.getByText('What amount should be sent?')).toBeInTheDocument();
    });
  });

  it('submits the form, renders the parsed intent card and confirms the intent', async () => {
    const intent = {
      amount: '25 XLM',
      recipient: 'GABC123',
      memo: 'consultation',
      isValid: true,
      clarification: ''
    };

    fetchSpy.mockResolvedValueOnce(jsonResponse(intent));

    render(
      <AIPaymentAssistant
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Submit the form and verify the parse request hit the API.
    const textarea = screen.getByPlaceholderText(/Send 50 XLM to GABC123/);
    const submitButton = screen.getByText('Parse Payment');

    fireEvent.change(textarea, { target: { value: 'Pay 25 XLM to GABC123 for the consultation' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/parse-payment',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' })
        })
      );
    });

    // A parsed intent card renders with the returned amount, recipient and memo.
    expect(await screen.findByText('Parsed Payment Details')).toBeInTheDocument();
    expect(screen.getByText('25 XLM')).toBeInTheDocument();
    expect(screen.getByText('GABC123')).toBeInTheDocument();
    expect(screen.getByText('consultation')).toBeInTheDocument();

    // Confirming forwards the exact parsed intent to onConfirm.
    fireEvent.click(screen.getByText('Fill Payment Form'));

    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    expect(mockOnConfirm).toHaveBeenCalledWith(intent);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});

describe('FloatingAssistantButton', () => {
  it('renders floating button', () => {
    const mockOnClick = jest.fn();

    render(<FloatingAssistantButton onClick={mockOnClick} />);

    const button = screen.getByLabelText('Open AI Payment Assistant');
    expect(button).toBeInTheDocument();
  });

  it('calls onClick when button is clicked', () => {
    const mockOnClick = jest.fn();

    render(<FloatingAssistantButton onClick={mockOnClick} />);

    const button = screen.getByLabelText('Open AI Payment Assistant');
    fireEvent.click(button);

    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });
});