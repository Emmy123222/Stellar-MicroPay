import React from 'react';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import Toast from '../components/Toast';

describe('Toast snapshot tests', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders visible info toast', () => {
    const { container } = render(
      <Toast message="This is an info toast" type="info" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders visible success toast', () => {
    const { container } = render(
      <Toast message="Operation completed successfully" type="success" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders visible error toast', () => {
    const { container } = render(
      <Toast message="An error occurred" type="error" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders hidden toast after auto-dismiss', () => {
    const { container } = render(
      <Toast message="This toast will be hidden" type="info" duration={1000} />
    );
    // Advance timers past the duration to trigger auto-dismiss
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders loading-style toast (using info type)', () => {
    const { container } = render(
      <Toast message="Loading..." type="info" duration={5000} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});