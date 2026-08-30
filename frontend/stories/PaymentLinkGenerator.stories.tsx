import type { Meta, StoryObj } from "@storybook/react";
import PaymentLinkGenerator from "@/components/PaymentLinkGenerator";
import { userEvent, within } from "@storybook/test";

const meta: Meta<typeof PaymentLinkGenerator> = {
  title: "Components/PaymentLinkGenerator",
  component: PaymentLinkGenerator,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof PaymentLinkGenerator>;

export const Default: Story = {
  decorators: [
    (Story) => (
      <div className="bg-slate-950 p-4 max-w-md mx-auto">
        <Story />
      </div>
    )
  ]
};

export const WithExpiry: Story = {
  decorators: [
    (Story) => (
      <div className="bg-slate-950 p-4 max-w-md mx-auto">
        <Story />
      </div>
    )
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    
    // Select expiry option
    // It's the only select element on the component
    const select = canvas.getByRole('combobox');
    await userEvent.selectOptions(select, '7d');
  }
};

export const GeneratedLink: Story = {
  decorators: [
    (Story) => (
      <div className="bg-slate-950 p-4 max-w-md mx-auto">
        <Story />
      </div>
    )
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    
    // Fill destination
    const destInput = canvas.getByPlaceholderText("G...");
    await userEvent.type(destInput, "GBTC7XKX234567890123456789012345678901234567890123456789");
    
    // Fill amount
    const amountInput = canvas.getByPlaceholderText("1.0");
    await userEvent.type(amountInput, "10");

    // Click generate button
    const button = canvas.getByRole('button', { name: /Create Link/i });
    await userEvent.click(button);
  }
};
