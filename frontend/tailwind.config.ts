import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--aw-bg)",
        ink: "var(--aw-text)",
        quiet: "var(--aw-text-soft)",
        faint: "var(--aw-text-faint)",
        panel: "var(--aw-panel)",
        panelStrong: "var(--aw-panel-strong)",
        panelMuted: "var(--aw-panel-muted)",
        line: "var(--aw-border)",
        lineStrong: "var(--aw-border-strong)",
        accent: "var(--aw-accent)",
        accentContrast: "var(--aw-accent-contrast)",
        overlay: "var(--aw-overlay)",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Helvetica Neue"', "Arial", "sans-serif"],
        mono: ['"IBM Plex Mono"', '"SFMono-Regular"', "monospace"],
      },
      boxShadow: {
        panel: "var(--aw-shadow)",
        soft: "var(--aw-shadow-soft)",
      },
      borderRadius: {
        card: "var(--aw-radius-lg)",
        pane: "var(--aw-radius-md)",
        chip: "var(--aw-radius-sm)",
      },
      height: {
        dvh: "100dvh",
      },
      minHeight: {
        dvh: "100dvh",
      },
    },
  },
  plugins: [],
};

export default config;
