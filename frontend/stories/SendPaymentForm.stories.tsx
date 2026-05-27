import type { Meta, StoryObj } from "@storybook/nextjs";
import SendPaymentForm from "@/components/SendPaymentForm";

const meta: Meta<typeof SendPaymentForm> = {
  title: "Components/SendPaymentForm",
  component: SendPaymentForm,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Form for sending XLM or USDC payments to any Stellar address. Supports federation addresses, memos, and asset selection.",
      },
    },
  },
  argTypes: {
    onSuccess: { action: "onSuccess" },
  },
};

export default meta;
type Story = StoryObj<typeof SendPaymentForm>;

const STUB_PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

export const Default: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    xlmBalance: "100.0000000",
    usdcBalance: "50.00",
  },
};

export const WithPrefill: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    xlmBalance: "100.0000000",
    prefill: {
      destination: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "5",
      memo: "Coffee",
    },
  },
};

export const USDCOnly: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    xlmBalance: "10.0000000",
    usdcBalance: "200.00",
    assetOptions: ["USDC" as never],
    hideAssetSelector: true,
  },
};

export const ReadOnlyDestination: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    xlmBalance: "100.0000000",
    destinationReadOnly: true,
    prefill: {
      destination: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "",
    },
  },
};
