import { useCallback, useState } from "react";

interface UseTurnstileFormOptions {
  onTurnstileError?: (turnstileError: string) => void;
}

export function useTurnstileForm(options: UseTurnstileFormOptions = {}) {
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  const resetTurnstile = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileResetKey((value) => value + 1);
  }, []);

  const handleTurnstileError = useCallback(
    (turnstileError: string | null) => {
      if (turnstileError) {
        options.onTurnstileError?.(turnstileError);
      }
    },
    [options.onTurnstileError],
  );

  return {
    turnstileToken,
    setTurnstileToken,
    turnstileResetKey,
    handleTurnstileError,
    resetTurnstile,
  };
}
