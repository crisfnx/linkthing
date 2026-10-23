import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { shellScript } from "@/lib/shell";
import { themeScript } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LinkVault",
  description:
    "Drop in a chat export or any text, and get every link back. Nothing leaves your browser.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The script sets data-theme and data-library before React hydrates
    // (lib/theme.ts, lib/shell.ts), so <html> may differ from what the
    // server rendered.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeScript + shellScript }}
        />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
