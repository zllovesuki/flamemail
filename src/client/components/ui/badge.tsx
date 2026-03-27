import type { HTMLAttributes, ReactNode } from "react";

const variantClasses = {
  default: "border-zinc-800/60 bg-zinc-900 text-zinc-500",
  accent: "bg-accent-500/10 text-accent-400",
  success: "bg-emerald-500/10 text-emerald-400",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  danger: "border-red-500/20 bg-red-500/10 text-red-400",
  muted: "bg-zinc-700/60 text-zinc-300",
} as const;

export type BadgeVariant = keyof typeof variantClasses;

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: ReactNode;
}

export function Badge({ variant = "default", icon, children, className, ...rest }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        variantClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
