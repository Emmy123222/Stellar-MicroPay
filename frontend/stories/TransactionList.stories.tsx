import type { Meta, StoryObj } from "@storybook/nextjs";
import TransactionList from "@/components/TransactionList";

const meta: Meta<typeof TransactionList> = {
  title: "Components/TransactionList",
  component: TransactionList,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Paginated list of Stellar payment history for an account. Supports sent/received filtering, memo search, and compact display mode.",
      },
    },
  },
  argTypes: {
    onPaymentsChange: { action: "onPaymentsChange" },
    onPrintReceipt: { action: "onPrintReceipt" },
    onSendAgain: { action: "onSendAgain" },
  },
};

export default meta;
type Story = StoryObj<typeof TransactionList>;

const STUB_PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

export const Default: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    limit: 10,
  },
};

export const Compact: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    limit: 5,
    compact: true,
  },
};

export const FilteredSent: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    limit: 10,
    filters: {
      direction: "sent",
      minAmount: "",
      memoSearch: "",
    },
  },
};

export const WithMemoSearch: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    limit: 10,
    filters: {
      direction: "all",
      minAmount: "",
      memoSearch: "coffee",
    },
  },
};
