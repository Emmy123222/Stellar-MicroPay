import type { Meta, StoryObj } from "@storybook/react";
import MultiSigFlow from "@/components/MultiSigFlow";

const STUB_PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const STUB_DESTINATION = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const meta: Meta<typeof MultiSigFlow> = {
  title: "Components/MultiSigFlow",
  component: MultiSigFlow,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Multi-signature payment wizard for high-value transactions. Guides initiators through build, sign, share, collect, and submit steps.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="bg-slate-950 p-4 max-w-lg w-full">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    onSuccess: { action: "onSuccess" },
  },
};

export default meta;
type Story = StoryObj<typeof MultiSigFlow>;

const baseArgs = {
  publicKey: STUB_PUBLIC_KEY,
  xlmBalance: "500.0000000",
  prefill: {
    destination: STUB_DESTINATION,
    amount: "150",
    memo: "High-value transfer",
  },
};

export const ZeroOfN: Story = {
  args: {
    ...baseArgs,
    defaultStep: "collect",
    defaultThreshold: 3,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Collect step with 0 of 3 signatures gathered. Shows the paste-XDR input for co-signers.",
      },
    },
  },
};

export const PartialSignatures: Story = {
  args: {
    ...baseArgs,
    defaultStep: "collect",
    defaultThreshold: 3,
    defaultInitiatorSignedXDR: "AAAA-stub-initiator-xdr",
  },
  parameters: {
    docs: {
      description: {
        story: "Collect step with 1 of 3 signatures (initiator signed, awaiting co-signers).",
      },
    },
  },
};

export const ThresholdMet: Story = {
  args: {
    ...baseArgs,
    defaultStep: "collect",
    defaultThreshold: 2,
    defaultInitiatorSignedXDR: "AAAA-stub-initiator-xdr",
    defaultCosignerXDRs: ["AAAA-stub-cosigner-xdr"],
  },
  parameters: {
    docs: {
      description: {
        story: "Collect step with threshold met (2 of 2 signatures). Proceed to Submit is enabled.",
      },
    },
  },
};

export const BuildStep: Story = {
  args: {
    publicKey: STUB_PUBLIC_KEY,
    xlmBalance: "500.0000000",
  },
  parameters: {
    docs: {
      description: {
        story: "Initial build step before any signatures are collected.",
      },
    },
  },
};
