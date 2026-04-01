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
        focusRing: "var(--aw-focus-ring)",
        stateSuccess: "var(--aw-state-success)",
        stateDanger: "var(--aw-state-danger)",
        stateWarning: "var(--aw-state-warning)",
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
      spacing: {
        gutter: "var(--aw-space-6)",
        section: "var(--aw-space-7)",
        panel: "var(--aw-space-5)",
      },
      height: {
        dvh: "100dvh",
      },
      minHeight: {
        dvh: "100dvh",
      },
      transitionTimingFunction: {
        productive: "var(--aw-ease-productive)",
        "productive-out": "var(--aw-ease-productive-out)",
      },
    },
  },
  plugins: [],
};

export default config;
