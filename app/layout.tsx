import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Simba | Fan Membership",
  description: "Your Simba fan number, regional community and membership.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
