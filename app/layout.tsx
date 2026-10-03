import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GhoomAI",
  description: "Plan it. Check it. Experience it.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
