import type { ReactNode } from "react";

interface ErrorBannerProps {
  children: ReactNode;
  className?: string;
}

export function ErrorBanner({ children, className }: ErrorBannerProps) {
  return (
    <p
      role="alert"
      className={["rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </p>
  );
}
