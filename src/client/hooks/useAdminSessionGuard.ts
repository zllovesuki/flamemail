import { useCallback } from "react";
import { getErrorMessage, isAdminSessionError } from "@/client/lib/api";

export function useAdminSessionGuard(onSessionError: (message?: string) => void) {
  return useCallback(
    (error: unknown, onUnhandledError?: (message: string) => void) => {
      const message = getErrorMessage(error);

      if (isAdminSessionError(error)) {
        onSessionError(message);
        return true;
      }

      onUnhandledError?.(message);
      return false;
    },
    [onSessionError],
  );
}
