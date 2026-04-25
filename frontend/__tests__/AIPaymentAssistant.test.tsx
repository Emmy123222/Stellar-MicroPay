/**
 * __tests__/AIPaymentAssistant.test.tsx
 * Tests for the AI Payment Assistant component
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AIPaymentAssistant, { FloatingAssistantButton } from '../components/AIPaymentAssistant';

// Mock fetch for API calls
global.fetch = jest.fn();

const mockOnClose = jest.fn();
const mockOnConfirm = jest.fn();

describe('AIPaymentAssistant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetch as jest.Mock).mockClear();
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

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });

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

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });

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