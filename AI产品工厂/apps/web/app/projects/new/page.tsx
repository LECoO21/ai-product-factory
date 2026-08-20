import { CreateProjectForm } from "@/components/create-project-form";

export default function NewProjectPage() {
  return (
    <div className="page page-narrow">
      <section className="form-intro">
        <span className="eyebrow">创建产品项目</span>
        <h1>先理解产品，再启动生产。</h1>
        <p>
          你不需要先选择“游戏模板”或“SaaS 模板”。工厂会从实际用户任务、交互、数据、风险和交付终端中生成生产蓝图。
        </p>
      </section>
      <CreateProjectForm />
    </div>
  );
}
