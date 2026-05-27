import type { Meta, StoryObj } from "@storybook/nextjs";
import WalletConnect from "@/components/WalletConnect";

const meta: Meta<typeof WalletConnect> = {
  title: "Components/WalletConnect",
  component: WalletConnect,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Wallet connection UI shown when no Stellar wallet is connected. Supports Freighter browser extension and Ledger hardware wallets.",
      },
    },
  },
  argTypes: {
    onConnectSuccess: { action: "onConnectSuccess" },
  },
};

export default meta;
type Story = StoryObj<typeof WalletConnect>;

export const Default: Story = {
  args: {},
};

export const WithSuccessCallback: Story = {
  args: {
    onConnectSuccess: (pk: string) => console.log("Connected:", pk),
  },
};
