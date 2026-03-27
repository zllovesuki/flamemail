import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  labelIcon?: ReactNode;
  helperText?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, labelIcon, helperText, error, className, id: idProp, ...rest }, ref) => {
    const generatedId = useId();
    const id = idProp ?? generatedId;
    const helperId = helperText ? `${id}-helper` : undefined;
    const errorId = error ? `${id}-error` : undefined;

    return (
      <div className="space-y-1.5">
        {label ? (
          <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-zinc-400">
            {labelIcon}
            {label}
          </label>
        ) : null}
        <input
          ref={ref}
          id={id}
          aria-describedby={errorId ?? helperId}
          aria-invalid={error ? true : undefined}
          className={[
            "w-full rounded-xl border border-zinc-700/60 bg-zinc-800/80 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:opacity-50",
            error && "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/30",
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          {...rest}
        />
        {error ? (
          <p id={errorId} className="text-xs text-red-400">
            {error}
          </p>
        ) : helperText ? (
          <p id={helperId} className="text-xs text-zinc-500">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  },
);

Input.displayName = "Input";
