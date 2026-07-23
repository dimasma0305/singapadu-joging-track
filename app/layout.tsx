import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const appFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Joging Track",
  description: "Single-QR jogging tracking web app with Leaflet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className={appFont.className}>{children}</body>
    </html>
  );
}
