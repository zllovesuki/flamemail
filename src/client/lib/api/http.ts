import { ADMIN_ACCESS_DISABLED_ERROR_CODE, ErrorResponse } from "@/shared/contracts";
import { D1_BOOKMARK_HEADER } from "@/shared/d1";
import { applyResponseBookmark, getStoredBookmark } from "./bookmarks";
import { clearAdminToken, getAdminToken } from "./session-storage";
import { type ApiRequestOptions, type Decoder } from "./shared";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function parseError(response: Response) {
  const fallback = `${response.status} ${response.statusText}`.trim();

  try {
    const payload = ErrorResponse.assertDecode(await response.json());
    return {
      code: payload.code,
      message: payload.error ?? fallback,
    };
  } catch {
    return {
      message: fallback,
    };
  }
}

export function encodeJsonBody<T>(decoder: Decoder<T>, value: unknown) {
  return JSON.stringify(decoder.assertDecode(value));
}

export async function fetchWithSession(path: string, options?: ApiRequestOptions) {
  const { token, bookmarkScope, onBookmark, ...requestInit } = options ?? {};
  const headers = new Headers(requestInit.headers);

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  if (bookmarkScope) {
    const bookmark = getStoredBookmark(bookmarkScope);
    if (bookmark) {
      headers.set(D1_BOOKMARK_HEADER, bookmark);
    }
  }

  const response = await fetch(path, {
    ...requestInit,
    headers,
  });

  applyResponseBookmark(response, { bookmarkScope, onBookmark });

  return response;
}

function shouldClearAdminToken(token: string | undefined, status: number, code?: string) {
  return (
    code === ADMIN_ACCESS_DISABLED_ERROR_CODE ||
    ((status === 401 || status === 403) && typeof token === "string" && token.length > 0 && getAdminToken() === token)
  );
}

export async function throwApiError(response: Response, token?: string): Promise<never> {
  const { code, message } = await parseError(response);

  if (shouldClearAdminToken(token, response.status, code)) {
    clearAdminToken();
  }

  throw new ApiError(message, response.status, code);
}

export async function request<T>(path: string, decoder: Decoder<T>, options?: ApiRequestOptions) {
  const headers = new Headers(options?.headers);
  headers.set("accept", "application/json");

  if (options?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetchWithSession(path, {
    ...options,
    headers,
  });

  if (!response.ok) {
    await throwApiError(response, options?.token);
  }

  return decoder.assertDecode(await response.json());
}
