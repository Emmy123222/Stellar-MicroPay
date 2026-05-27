import type { Meta, StoryObj } from "@storybook/nextjs";
import Navbar from "@/components/Navbar";

const meta: Meta<typeof Navbar> = {
  title: "Components/Navbar",
  component: Navbar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Top navigation bar with route links, network status indicator, fee level badge, theme toggle, and wallet connect/disconnect controls.",
      },
    },
    nextjs: {
      router: {
        pathname: "/",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Navbar>;

export const Default: Story = {};

export const DashboardActive: Story = {
  parameters: {
    nextjs: {
      router: {
        pathname: "/dashboard",
      },
    },
  },
};

export const TransactionsActive: Story = {
  parameters: {
    nextjs: {
      router: {
        pathname: "/transactions",
      },
    },
  },
};
