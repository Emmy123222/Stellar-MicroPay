import type { Meta, StoryObj } from "@storybook/react";
import CreatorTipsDashboard from "@/components/CreatorTipsDashboard";

const meta: Meta<typeof CreatorTipsDashboard> = {
  title: "Components/CreatorTipsDashboard",
  component: CreatorTipsDashboard,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof CreatorTipsDashboard>;

const STUB_PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

const MOCK_TIPS = {
  success: true,
  data: {
    stats: {
      totalTips: 2,
      totalByAsset: { XLM: { count: 2, amount: "150.0" } },
      averageTip: "75.0",
      largestTip: "100.0",
      smallestTip: "50.0"
    },
    tips: [
      {
        id: 1,
        senderPublicKey: "GCQGHY...",
        creatorPublicKey: STUB_PUBLIC_KEY,
        amount: "50.0",
        asset: "XLM",
        memo: "Great work!",
        txHash: "hash1",
        timestamp: new Date().toISOString()
      },
      {
        id: 2,
        senderPublicKey: "GBAXYA...",
        creatorPublicKey: STUB_PUBLIC_KEY,
        amount: "100.0",
        asset: "XLM",
        memo: "Thanks!",
        txHash: "hash2",
        timestamp: new Date(Date.now() - 86400000).toISOString()
      }
    ]
  }
};

export const Loading: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    username: "testuser",
    xlmPrice: 0.12,
  },
  decorators: [
    (Story) => {
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        if (input.toString().includes('/api/tips/received')) {
           return new Promise(() => {}); 
        }
        return originalFetch(input, init);
      };
      return <div className="p-4 bg-slate-950"><Story /></div>;
    }
  ]
};

export const Empty: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    username: "testuser",
    xlmPrice: 0.12,
  },
  decorators: [
    (Story) => {
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        if (input.toString().includes('/api/tips/received')) {
           return Promise.resolve(new Response(JSON.stringify({ success: true, data: { stats: { totalTips: 0, totalByAsset: {} }, tips: [] } })));
        }
        return originalFetch(input, init);
      };
      return <div className="p-4 bg-slate-950"><Story /></div>;
    }
  ]
};

export const Populated: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    username: "testuser",
    xlmPrice: 0.12,
  },
  decorators: [
    (Story) => {
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        if (input.toString().includes('/api/tips/received')) {
           return Promise.resolve(new Response(JSON.stringify(MOCK_TIPS)));
        }
        return originalFetch(input, init);
      };
      return <div className="p-4 bg-slate-950"><Story /></div>;
    }
  ]
};
