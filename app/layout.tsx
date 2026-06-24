import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Finance AI — VN30 Dashboard",
  description: "Theo dõi VN30 + phân tích bằng GLM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
