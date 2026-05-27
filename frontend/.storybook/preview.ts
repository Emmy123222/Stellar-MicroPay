import type { Preview } from "@storybook/nextjs";
import "../styles/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "dark",
      values: [
        { name: "dark", value: "#050a1a" },
        { name: "light", value: "#f0f6ff" },
      ],
    },
    nextjs: {
      appDirectory: false,
    },
  },
  decorators: [
    (Story) => {
      if (typeof document !== "undefined") {
        document.documentElement.classList.add("dark");
      }
      return Story();
    },
  ],
};

export default preview;
