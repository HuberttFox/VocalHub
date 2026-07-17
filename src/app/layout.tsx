import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VocalHub",
  description: "面向中文用户的现代术曲发现平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
