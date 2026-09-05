import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "@/components/login-form";
import { isCurrentRequestAuthenticated } from "@/lib/auth/current-user";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await isCurrentRequestAuthenticated()) redirect("/");
  const nextPath = (await searchParams).next ?? "/";
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand"><BrandMark /><strong>ProdLine</strong></div>
        <h1>进入 AI 产品工厂</h1>
        <p>先登录你自己的 OpenAI（ChatGPT）账户。</p>
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}
