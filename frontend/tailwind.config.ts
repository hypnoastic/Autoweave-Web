import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f5f5f3",
        ink: "#111111",
        stone: "#d6d2ca",
        panel: "#ffffff",
        quiet: "#6b6b67",
        line: "#dbd7ce",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Helvetica Neue"', "Arial", "sans-serif"],
        mono: ['"IBM Plex Mono"', '"SFMono-Regular"', "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 rgba(17,17,17,0.06), 0 18px 40px rgba(17,17,17,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
