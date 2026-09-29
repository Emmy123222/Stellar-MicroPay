/**
 * components/ErrorBoundary.tsx
 * Class-based error boundary: catches render errors in its subtree and
 * shows a friendly fallback UI instead of crashing the whole app.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback UI. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /**
   * Called with the caught error and React's component stack, in addition
   * to the default `console.error` logging. Wire this to an error reporting
   * service (e.g. Sentry) when one is configured.
   */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Unhandled render error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4 dark:bg-cosmos-900">
        <div className="w-full max-w-sm rounded-xl border border-red-400/30 bg-red-400/5 p-6 text-center">
          <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            An unexpected error occurred. You can try again, or reload the page
            if the problem persists.
          </p>
          <button onClick={this.reset} className="btn-primary mt-4 px-4 py-2 text-sm">
            Try again
          </button>
        </div>
      </div>
    );
  }
}
