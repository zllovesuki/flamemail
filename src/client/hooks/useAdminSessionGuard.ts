import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getErrorMessage, isAdminSessionError } from "@/client/lib/api";

export function useAdminSessionGuard(onSessionError?: (message?: string) => void) {
  const navigate = useNavigate();

  return useCallback(
    (error: unknown, onUnhandledError?: (message: string) => void) => {
      const message = getErrorMessage(error);

      if (isAdminSessionError(error)) {
        onSessionError?.(message);
        // The httpOnly admin cookie has either expired or was rejected
        // server-side. Navigate back to /admin so the page renders the
        // tessera sign-in card from its own 401/403 fall-through.
        navigate("/admin", { replace: true });
        return true;
      }

      onUnhandledError?.(message);
      return false;
    },
    [navigate, onSessionError],
  );
}
