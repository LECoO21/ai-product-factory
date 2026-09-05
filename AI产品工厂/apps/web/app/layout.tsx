import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getProductFactory } from "@factory/production";
import { FactorySidebar } from "@/components/factory-sidebar";
import { isCurrentRequestAuthenticated } from "@/lib/auth/current-user";
import { isFactoryAuthBypassed } from "@/lib/auth/session";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ProdLine | AI 产品工厂",
  description: "把 PRD 变成可控制、可验证、可恢复的产品生产流程。"
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const authenticationRequired = !isFactoryAuthBypassed();
  const authenticated = await isCurrentRequestAuthenticated();
  if (!authenticated) {
    return <html lang="zh-CN" data-scroll-behavior="smooth"><body>{children}</body></html>;
  }
  const projects = getProductFactory().listProjects();

  return (
    <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <div className="app-shell">
          <FactorySidebar projects={projects} showLogout={authenticationRequired} />
          <main className="factory-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
