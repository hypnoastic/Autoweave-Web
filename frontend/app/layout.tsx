import "./globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AutoWeave Web",
  description: "Local-first collaborative engineering built around the AutoWeave runtime.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
