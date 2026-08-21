import { CreateProjectForm } from "@/components/create-project-form";

export default function NewProjectPage() {
  return (
    <div className="page page-narrow">
      <section className="form-intro">
        <h1>新建产品</h1>
      </section>
      <CreateProjectForm />
    </div>
  );
}
