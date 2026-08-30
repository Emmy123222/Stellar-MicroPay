import type { Meta, StoryObj } from "@storybook/react";
import PaymentStatusModal from "@/components/PaymentStatusModal";

const meta: Meta<typeof PaymentStatusModal> = {
  title: "Components/PaymentStatusModal",
  component: PaymentStatusModal,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof PaymentStatusModal>;

const defaultStepTimings = {
  building: { startedAt: Date.now() - 5000, completedAt: null, error: null },
  signing: { startedAt: null, completedAt: null, error: null },
  submitting: { startedAt: null, completedAt: null, error: null },
  confirming: { startedAt: null, completedAt: null, error: null },
};

export const Pending: Story = {
  args: {
    isOpen: true,
    status: "building",
    txHash: null,
    error: null,
    failedStep: null,
    stepTimings: defaultStepTimings,
    onClose: () => console.log("close"),
  }
};

export const Success: Story = {
  args: {
    isOpen: true,
    status: "success",
    txHash: "a1b2c3d4e5f6g7h8i9j0",
    explorerHref: "https://stellar.expert/explorer/public/tx/a1b2c3d4e5f6g7h8i9j0",
    error: null,
    failedStep: null,
    stepTimings: {
      building: { startedAt: Date.now() - 10000, completedAt: Date.now() - 9000, error: null },
      signing: { startedAt: Date.now() - 9000, completedAt: Date.now() - 8000, error: null },
      submitting: { startedAt: Date.now() - 8000, completedAt: Date.now() - 5000, error: null },
      confirming: { startedAt: Date.now() - 5000, completedAt: Date.now() - 2000, error: null },
    },
    onClose: () => console.log("close"),
  }
};

export const Failed: Story = {
  args: {
    isOpen: true,
    status: "error",
    txHash: null,
    error: "Transaction failed to submit",
    failedStep: "submitting",
    stepTimings: {
      building: { startedAt: Date.now() - 10000, completedAt: Date.now() - 9000, error: null },
      signing: { startedAt: Date.now() - 9000, completedAt: Date.now() - 8000, error: null },
      submitting: { startedAt: Date.now() - 8000, completedAt: null, error: "Network timeout" },
      confirming: { startedAt: null, completedAt: null, error: null },
    },
    onClose: () => console.log("close"),
  }
};
