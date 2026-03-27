import { forwardRef, type HTMLAttributes } from "react";

const variantClasses = {
  default: "rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 sm:p-6",
  accent: "rounded-2xl border border-accent-500/20 bg-gradient-to-br from-zinc-900/80 to-zinc-900/40 p-5 sm:p-6",
} as const;

export type CardVariant = keyof typeof variantClasses;

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "default", interactive, children, className, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={[
          variantClasses[variant],
          interactive &&
            "cursor-pointer hover:-translate-y-0.5 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {children}
      </div>
    );
  },
);

Card.displayName = "Card";
