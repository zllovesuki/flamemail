import { ADMIN_ACCESS_DISABLED_ERROR_CODE } from "@/shared/contracts";
import { ApiError } from "./http";

export function isAdminAccessDisabledError(error: unknown) {
  return error instanceof ApiError && error.code === ADMIN_ACCESS_DISABLED_ERROR_CODE;
}

export function isAdminSessionError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.code === ADMIN_ACCESS_DISABLED_ERROR_CODE || error.status === 401 || error.status === 403)
  );
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong";
}

export function isTurnstileError(error: unknown) {
  return error instanceof ApiError && /human verification/i.test(error.message);
}
