import type { ReactNode } from "react";

export function PatientPageHeading({ icon, title, description }: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <header className="flex items-start gap-3 border-b border-border bg-accent/45 px-5 py-6 sm:gap-4 sm:px-9 sm:py-8">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-card text-primary sm:size-12" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <h1 className="patient-display-title">{title}</h1>
        <p className="patient-display-copy">{description}</p>
      </div>
    </header>
  );
}
