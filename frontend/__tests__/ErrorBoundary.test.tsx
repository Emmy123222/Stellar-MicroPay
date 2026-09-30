import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "@/components/ErrorBoundary";

function ThrowingChild(): never {
  throw new Error("Boom");
}

function SafeChild() {
  return <div>All good</div>;
}

describe("ErrorBoundary", () => {
  // React logs the caught error to the console by default; silence it for
  // these tests so expected failures don't clutter test output.
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = jest.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <SafeChild />
      </ErrorBoundary>
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("renders the default fallback UI when a child throws during render", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("All good")).not.toBeInTheDocument();
  });

  it("logs the caught error via console.error", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(console.error).toHaveBeenCalledWith(
      "[ErrorBoundary] Unhandled render error:",
      expect.any(Error),
      expect.anything()
    );
  });

  it("calls the optional onError callback with the error and error info", () => {
    const onError = jest.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    const [error] = onError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Boom");
  });

  it("renders a custom fallback when provided, instead of the default UI", () => {
    render(
      <ErrorBoundary fallback={(error) => <div>Custom: {error.message}</div>}>
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(screen.getByText("Custom: Boom")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("'Try again' resets the boundary, re-rendering children on the next attempt", () => {
    let shouldThrow = true;
    function Sometimes() {
      if (shouldThrow) throw new Error("Boom");
      return <div>Recovered</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <Sometimes />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    rerender(
      <ErrorBoundary>
        <Sometimes />
      </ErrorBoundary>
    );

    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });
});
