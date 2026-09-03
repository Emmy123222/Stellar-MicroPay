import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within, expect } from "@storybook/test";

import BatchPaymentForm from "@/components/BatchPaymentForm";

const meta: Meta<typeof BatchPaymentForm> = {
  title: "Components/BatchPaymentForm",
  component: BatchPaymentForm,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Form for sending XLM payments to multiple recipients in a single batch. Supports up to 10 recipients with individual status tracking, memo fields, and retry functionality for failed payments.",
      },
    },
  },
  argTypes: {
    onBatchSuccess: { action: "onBatchSuccess" },
  },
};

export default meta;
type Story = StoryObj<typeof BatchPaymentForm>;

const STUB_PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

export const Default: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    xlmBalance: "100.0000000",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Default state with a single empty recipient row. The form shows the recipient count (1/10), Add recipient button, total XLM display, and Send batch button (disabled until valid data is entered).",
      },
    },
  },
};

export const WithThreeRecipients: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    xlmBalance: "100.0000000",
  },
  parameters: {
    docs: {
      description:
        "Form with three recipient rows added. Each row has fields for address, amount, and optional memo. The total XLM is calculated across all recipients.",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const addButton = canvas.getByRole("button", { name: /add recipient/i });
    await userEvent.click(addButton);
    await userEvent.click(addButton);

    const addressInputs = canvas.getAllByPlaceholderText("G...");
    const amountInputs = canvas.getAllByPlaceholderText("0.5");

    await userEvent.type(
      addressInputs[0],
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    );
    await userEvent.type(amountInputs[0], "10");

    await userEvent.type(
      addressInputs[1],
      "GAZKZBZ5R4VZQ5E7Y6C7QD6J7K7L7M7N7O7P7Q7R7S7T7U7V7W7X7Y7Z"
    );
    await userEvent.type(amountInputs[1], "5");

    await userEvent.type(
      addressInputs[2],
      "GABCDEF123456789012345678901234567890123456789012345678"
    );
    await userEvent.type(amountInputs[2], "3");
  },
};

export const WithInvalidRow: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    xlmBalance: "100.0000000",
  },
  parameters: {
    docs: {
      description:
        "Form showing validation error when a recipient has an invalid address or amount. The error message appears below the row when the user attempts to submit.",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const addButton = canvas.getByRole("button", { name: /add recipient/i });
    await userEvent.click(addButton);

    const addressInputs = canvas.getAllByPlaceholderText("G...");
    const amountInputs = canvas.getAllByPlaceholderText("0.5");

    await userEvent.type(addressInputs[0], "not-a-valid-address");
    await userEvent.type(amountInputs[0], "10");

    await userEvent.type(
      addressInputs[1],
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    );
    await userEvent.type(amountInputs[1], "5");

    const sendButton = canvas.getByRole("button", { name: /send batch/i });
    await userEvent.click(sendButton);

    await expect(canvas.getByText("Invalid Stellar address.")).toBeInTheDocument();
  },
};
