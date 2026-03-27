import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

const variantClasses = {
  primary:
    "bg-gradient-to-r from-accent-500 to-accent-600 text-white shadow-sm shadow-accent-500/10 hover:from-accent-400 hover:to-accent-500 active:scale-[0.98]",
  secondary: "border border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700/60 active:scale-[0.98]",
  danger: "border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-[0.98]",
  ghost: "text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100 active:scale-[0.97]",
} as const;

const sizeClasses = {
  sm: "gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
  md: "gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold",
} as const;

export type ButtonVariant = keyof typeof variantClasses;
export type ButtonSize = keyof typeof sizeClasses;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "sm", loading, icon, children, className, disabled, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        className={[
          "inline-flex items-center justify-center transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled || loading}
        {...rest}
      >
        {loading ? <Loader2 className={size === "sm" ? "h-3.5 w-3.5 animate-spin" : "h-4 w-4 animate-spin"} /> : icon}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
