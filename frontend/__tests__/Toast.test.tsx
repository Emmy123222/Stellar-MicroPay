import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import Toast, { ToastContainer } from "@/components/Toast";
import { ToastProvider, useToastContext } from "@/lib/ToastContext";

jest.mock("@/components/icons", () => ({
  CheckIcon: ({ className }: { className?: string }) => <svg data-testid="check-icon" className={className} />,
  AlertCircleIcon: ({ className }: { className?: string }) => <svg data-testid="alert-icon" className={className} />,
}));

// ─── Individual <Toast /> unit tests ─────────────────────────────────────────

describe("Toast component", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("renders the message text", () => {
    render(<Toast message="Payment sent!" type="success" />);
    expect(screen.getByText("Payment sent!")).toBeInTheDocument();
  });

  it("renders success variant with check icon", () => {
    render(<Toast message="Done" type="success" />);
    expect(screen.getByTestId("check-icon")).toBeInTheDocument();
  });

  it("renders error variant with alert icon", () => {
    render(<Toast message="Failed" type="error" />);
    expect(screen.getByTestId("alert-icon")).toBeInTheDocument();
  });

  it("renders info variant without an icon", () => {
    render(<Toast message="Info" type="info" />);
    expect(screen.queryByTestId("check-icon")).not.toBeInTheDocument();
    expect(screen.queryByTestId("alert-icon")).not.toBeInTheDocument();
  });

  it("calls onClose after the duration timeout", () => {
    const onClose = jest.fn();
    render(<Toast message="Auto-dismiss" type="info" duration={1000} onClose={onClose} />);

    act(() => jest.advanceTimersByTime(1000));
    // The component sets visible=false, then fires onClose after 300 ms
    act(() => jest.advanceTimersByTime(300));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose immediately when the dismiss button is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = jest.fn();
    render(<Toast message="Dismiss me" type="info" onClose={onClose} />);

    await user.click(screen.getByLabelText("Dismiss notification"));
    act(() => jest.advanceTimersByTime(300));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows Retry button only for error toasts that have onRetry", async () => {
    const onRetry = jest.fn();
    render(<Toast message="Err" type="error" onRetry={onRetry} />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("does not show Retry button for success toasts", () => {
    render(<Toast message="OK" type="success" onRetry={jest.fn()} />);
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("calls onRetry when the Retry button is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const onRetry = jest.fn();
    const onClose = jest.fn();
    render(<Toast message="Err" type="error" onRetry={onRetry} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has role=status for accessibility", () => {
    render(<Toast message="A11y" type="info" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

// ─── ToastContainer stacking tests ──────────────────────────────────────────

function AddToastButton() {
  const { addToast } = useToastContext();
  return (
    <button
      type="button"
      onClick={() => addToast("Toast A", "success")}
    >
      Add toast
    </button>
  );
}

function ErrorToastButton() {
  const { addToast } = useToastContext();
  return (
    <button
      type="button"
      onClick={() => addToast("Toast Error", "error")}
    >
      Add error toast
    </button>
  );
}

function MultiToastButton() {
  const { addToast } = useToastContext();
  return (
    <>
      <button type="button" onClick={() => addToast("First", "info")}>Add first</button>
      <button type="button" onClick={() => addToast("Second", "success")}>Add second</button>
    </>
  );
}

describe("ToastContainer", () => {
  it("renders nothing when there are no toasts", () => {
    render(
      <ToastProvider>
        <ToastContainer />
      </ToastProvider>
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders a toast when one is added via context", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <AddToastButton />
        <ToastContainer />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "Add toast" }));
    expect(screen.getByText("Toast A")).toBeInTheDocument();
  });

  it("stacks multiple toasts without clobbering each other", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <MultiToastButton />
        <ToastContainer />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "Add first" }));
    await user.click(screen.getByRole("button", { name: "Add second" }));

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("uses aria-live=assertive when an error toast is present", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ErrorToastButton />
        <ToastContainer />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "Add error toast" }));
    const region = screen.getByLabelText("Notifications");
    expect(region).toHaveAttribute("aria-live", "assertive");
  });

  it("uses aria-live=polite when there are only non-error toasts", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <AddToastButton />
        <ToastContainer />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "Add toast" }));
    const region = screen.getByLabelText("Notifications");
    expect(region).toHaveAttribute("aria-live", "polite");
  });
});
