import type { Meta, StoryObj } from "@storybook/react";

import { ErrorBoundary } from "@/components/ErrorBoundary";

function HealthyChild() {
  return (
    <div className="p-6 rounded-2xl border border-white/10 bg-white/5 text-slate-200 max-w-lg">
      <h3 className="text-lg font-semibold text-white">Payment Widget</h3>
      <p className="mt-2 text-sm text-slate-400">
        This section rendered successfully inside the error boundary.
      </p>
    </div>
  );
}

function BrokenChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Simulated render failure for Storybook preview");
  }
  return <HealthyChild />;
}

const meta: Meta<typeof ErrorBoundary> = {
  title: "Components/ErrorBoundary",
  component: ErrorBoundary,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Premium error boundary that isolates rendering failures in critical widgets and shows a recoverable fallback UI.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ErrorBoundary>;

export const NormalChildren: Story = {
  render: () => (
    <ErrorBoundary name="Payment Widget">
      <HealthyChild />
    </ErrorBoundary>
  ),
  parameters: {
    docs: {
      description: {
        story: "Renders children normally when no error occurs.",
      },
    },
  },
};

export const ForcedErrorFallback: Story = {
  render: () => (
    <ErrorBoundary name="Payment Widget">
      <BrokenChild shouldThrow />
    </ErrorBoundary>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Catches a thrown render error and displays the default fallback with error details and a Try Again button.",
      },
    },
  },
};

export const CustomFallback: Story = {
  render: () => (
    <ErrorBoundary
      name="Payment Widget"
      fallback={
        <div className="p-6 rounded-2xl border border-amber-500/20 bg-amber-950/10 text-amber-200 max-w-lg">
          Custom fallback UI — the widget is temporarily unavailable.
        </div>
      }
    >
      <BrokenChild shouldThrow />
    </ErrorBoundary>
  ),
  parameters: {
    docs: {
      description: {
        story: "Uses a custom fallback node instead of the default error card.",
      },
    },
  },
};
