import type { ReactNode } from "react";

interface PageHeaderProps {
  caption?: string;
  captionIcon?: ReactNode;
  heading: string;
  description?: string;
  children?: ReactNode;
}

export function PageHeader({ caption, captionIcon, heading, description, children }: PageHeaderProps) {
  return (
    <div>
      {caption ? (
        <div className="mb-2 flex items-center gap-1.5">
          {captionIcon}
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{caption}</span>
        </div>
      ) : null}
      <h2 className="text-lg font-semibold text-zinc-100">{heading}</h2>
      {description ? <p className="mt-2 text-sm text-zinc-500">{description}</p> : null}
      {children}
    </div>
  );
}
