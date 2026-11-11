import type { ReactNode } from "react";

export function PatientPageHeading({ icon, title, description, plain = false }: {
  /** plain 模式不显示图标，可省略 */
  icon?: ReactNode;
  title: string;
  description: string;
  plain?: boolean;
}) {
  if (plain) {
    return (
      <header className="assessment-page-heading">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
    );
  }

  return (
    <header className="flex items-start gap-3 rounded-t-[inherit] border-b border-border bg-accent/45 px-5 py-5 sm:gap-4 sm:px-7 sm:py-6">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-card text-primary sm:size-12" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <h1 className="text-[clamp(1.65rem,3.5vw,2.5rem)] leading-tight font-bold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </header>
  );
}
