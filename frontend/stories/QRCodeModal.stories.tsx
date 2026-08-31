import type { Meta, StoryObj } from "@storybook/react";

import QRCodeModal from "@/components/QRCodeModal";

/** Sample Stellar testnet address used across Storybook fixtures. */
const TESTNET_PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

const meta: Meta<typeof QRCodeModal> = {
  title: "Components/QRCodeModal",
  component: QRCodeModal,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Modal for displaying a SEP-0007 Stellar payment QR code. Supports optional amount encoding and PNG download.",
      },
    },
  },
  argTypes: {
    onClose: { action: "onClose" },
  },
};

export default meta;
type Story = StoryObj<typeof QRCodeModal>;

export const TestnetAddress: Story = {
  args: {
    isOpen: true,
    publicKey: TESTNET_PUBLIC_KEY,
    onClose: () => console.log("close"),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Open modal with a sample testnet address. QR encodes web+stellar:pay?destination=G...",
      },
    },
  },
};

export const WithAmount: Story = {
  args: {
    isOpen: true,
    publicKey: TESTNET_PUBLIC_KEY,
    amount: "25.5",
    onClose: () => console.log("close"),
  },
  parameters: {
    docs: {
      description: {
        story:
          "QR code includes a fixed amount in the SEP-0007 URI (web+stellar:pay?destination=G...&amount=25.5).",
      },
    },
  },
};

export const Closed: Story = {
  args: {
    isOpen: false,
    publicKey: TESTNET_PUBLIC_KEY,
    onClose: () => console.log("close"),
  },
  parameters: {
    docs: {
      description: {
        story: "Modal hidden when isOpen is false.",
      },
    },
  },
};
