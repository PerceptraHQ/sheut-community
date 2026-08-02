import type { ReactNode } from "react";

interface EditorSectionProps {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}

export function EditorSection({ action, children, description, title }: EditorSectionProps) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="m-0 text-copy-primary text-xs font-semibold">{title}</h3>
          {description ? (
            <p className="mt-1 mb-0 text-[11px] text-copy-faint">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
