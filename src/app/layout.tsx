import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "RealtyWorks",
  description:
    "Work interface for property managers and landlords to run maintenance and repair operations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      {/* globals.css maps --font-sans to Geist via @theme inline, but nothing
          applied it — without `font-sans` the app renders in the browser
          default and the loaded font is dead weight. */}
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
