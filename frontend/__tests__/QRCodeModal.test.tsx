import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import QRCodeModal from '../components/QRCodeModal';

describe('QRCodeModal snapshot tests', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    publicKey: 'GABCDE1234567890GABCDE1234567890GABCDE1234567890GABCDE12',
    amount: undefined,
  };

  it('renders with sample address (no amount)', () => {
    const { container } = render(<QRCodeModal {...defaultProps} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders with sample address and amount', () => {
    const { container } = render(
      <QRCodeModal {...defaultProps} amount="10.5" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders with sample address and zero amount', () => {
    const { container } = render(
      <QRCodeModal {...defaultProps} amount="0" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders closed state (isOpen=false)', () => {
    const { container } = render(
      <QRCodeModal {...defaultProps} isOpen={false} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders with a different sample address', () => {
    const { container } = render(
      <QRCodeModal
        {...defaultProps}
        publicKey='GDIFFERENTADDRESS123456789012345678901234567890123456'
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});