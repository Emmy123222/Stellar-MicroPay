import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react";

import AIPaymentAssistant from "@/components/AIPaymentAssistant";
import FloatingAssistantButton from "@/components/FloatingAssistantButton";

const meta: Meta<typeof AIPaymentAssistant> = {
  title: "Components/AIPaymentAssistant",
  component: AIPaymentAssistant,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "AI-powered payment assistant that parses natural language payment requests. The floating launcher button opens the assistant panel as a modal dialog.",
      },
    },
  },
  decorators: [
    (Story) => {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("stellar-micropay:ai-conversation");
      }
      return <Story />;
    },
  ],
  argTypes: {
    onClose: { action: "onClose" },
    onConfirm: { action: "onConfirm" },
  },
};

export default meta;
type Story = StoryObj<typeof AIPaymentAssistant>;

export const FloatingLauncher: Story = {
  render: () => (
    <div className="relative min-h-[400px] bg-slate-950">
      <FloatingAssistantButton onClick={() => console.log("open assistant")} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Always-visible floating button that opens the AI Payment Assistant panel. Kept separate from the panel so the heavier assistant bundle loads on demand.",
      },
    },
  },
};

export const PanelOpen: Story = {
  args: {
    isOpen: true,
    onClose: () => console.log("close"),
    onConfirm: (intent) => console.log("confirm", intent),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Assistant panel in its default open state with an empty conversation and payment input form.",
      },
    },
  },
};

export const PanelClosed: Story = {
  args: {
    isOpen: false,
    onClose: () => console.log("close"),
    onConfirm: (intent) => console.log("confirm", intent),
  },
  parameters: {
    docs: {
      description: {
        story: "When closed, the assistant panel renders nothing (null).",
      },
    },
  },
};

export const LauncherWithPanel: Story = {
  render: function LauncherWithPanelStory() {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <div className="relative min-h-[600px] bg-slate-950">
        <FloatingAssistantButton onClick={() => setIsOpen(true)} />
        <AIPaymentAssistant
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onConfirm={(intent) => {
            console.log("confirm", intent);
            setIsOpen(false);
          }}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Combined launcher and panel, mirroring dashboard integration. Click the floating button to open the assistant.",
      },
    },
  },
};
