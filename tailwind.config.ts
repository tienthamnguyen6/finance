import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f1a",
        panel: "#121826",
        border: "#1f2937",
        up: "#16a34a",
        down: "#dc2626",
      },
    },
  },
  plugins: [],
};
export default config;
