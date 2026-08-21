import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 产品工厂",
  description: "把 PRD 变成可控制、可验证、可恢复的产品生产流程。"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <div className="app-shell">
          <header className="topbar">
            <Link href="/" className="brand" aria-label="返回 AI 产品工厂首页">
              <span className="brand-mark" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>
                <strong>AI 产品工厂</strong>
              </span>
            </Link>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
