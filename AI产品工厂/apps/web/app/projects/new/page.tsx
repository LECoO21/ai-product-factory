import { CreateProjectForm } from "@/components/create-project-form";

export default function NewProjectPage() {
  return (
    <div className="page page-narrow">
      <section className="form-intro">
        <span>Naxe Agent</span>
        <h1>说说你想做什么</h1>
      </section>
      <CreateProjectForm />
    </div>
  );
}
