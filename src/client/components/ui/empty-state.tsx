import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  heading: string;
  description?: string;
  caption?: string;
  children?: ReactNode;
}

export function EmptyState({ icon, heading, description, caption, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="inline-grid h-14 w-14 place-items-center rounded-full bg-zinc-800/60">{icon}</span>
      <div>
        {caption ? (
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-600">{caption}</span>
        ) : null}
        <h2 className="text-lg font-semibold text-zinc-300">{heading}</h2>
        {description ? <p className="mt-2 max-w-sm text-sm text-zinc-500">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
