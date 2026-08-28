import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "@/components/login-form";
import { isCurrentRequestAuthenticated } from "@/lib/auth/current-user";
import { isFactoryAuthenticationRequired } from "@/lib/auth/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!isFactoryAuthenticationRequired() || await isCurrentRequestAuthenticated()) redirect("/");
  const nextPath = (await searchParams).next ?? "/";
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand"><BrandMark /><strong>Naxe</strong></div>
        <h1>进入 AI 产品工厂</h1>
        <p>输入你的邀请码。</p>
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}
