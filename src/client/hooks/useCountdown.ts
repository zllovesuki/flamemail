import { useEffect, useState } from "react";
import { formatCountdown } from "@/client/lib/time";

export function useCountdown(expiresAt: string | null) {
  const [text, setText] = useState(() => (expiresAt ? formatCountdown(expiresAt) : ""));

  useEffect(() => {
    if (!expiresAt) {
      setText("");
      return;
    }

    setText(formatCountdown(expiresAt));
    const id = window.setInterval(() => setText(formatCountdown(expiresAt)), 30_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return text;
}
