/**
 * components/ErrorBoundary.tsx
 * Custom premium error boundary to isolate and catch rendering errors in critical widgets.
 */

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircleIcon } from "@/components/icons";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`ErrorBoundary caught an error in ${this.props.name || "component"}:`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="p-6 rounded-2xl border border-red-500/20 bg-red-950/10 backdrop-blur-md text-slate-200 shadow-xl max-w-lg mx-auto my-4 animate-fade-in">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-red-500/10 text-red-400 flex-shrink-0">
              <AlertCircleIcon className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-red-400">
                Failed to load {this.props.name || "component"}
              </h3>
              <p className="mt-1 text-sm text-slate-400 leading-relaxed">
                An unexpected error occurred while rendering this section.
              </p>
              {this.state.error && (
                <div className="mt-3 p-3 rounded-lg bg-black/40 border border-white/5 text-xs font-mono text-slate-500 max-h-32 overflow-auto">
                  {this.state.error.toString()}
                </div>
              )}
              <button
                onClick={this.handleReset}
                className="mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 active:bg-red-500/40 border border-red-500/30 text-red-300 text-sm font-medium rounded-xl transition-all duration-200"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  name: string
) {
  const ComponentWithErrorBoundary = (props: P) => (
    <ErrorBoundary name={name}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  ComponentWithErrorBoundary.displayName = `WithErrorBoundary(${
    WrappedComponent.displayName || WrappedComponent.name || "Component"
  })`;

  return ComponentWithErrorBoundary;
}
