import { EmailDetail, EmailPage, OkResponse } from "@/shared/contracts";
import { getInboxBookmarkScope } from "./bookmarks";
import { fetchWithSession, parseError, request, ApiError } from "./http";
import type { AuthDescriptor } from "./shared";

function buildEmailsPath(address: string, suffix: string, query: URLSearchParams, auth: AuthDescriptor) {
  if (auth.mode === "admin") {
    query.set("admin", "1");
  }
  const queryString = query.toString();
  const base = `/api/protected/inboxes/${encodeURIComponent(address)}${suffix}`;
  return queryString ? `${base}?${queryString}` : base;
}

function bearerToken(auth: AuthDescriptor) {
  return auth.mode === "user" ? auth.token : undefined;
}

export async function listEmails(
  address: string,
  auth: AuthDescriptor,
  options: {
    page?: number;
    includeTotal?: boolean;
  } = {},
) {
  const params = new URLSearchParams({
    page: String(options.page ?? 0),
  });

  if (options.includeTotal) {
    params.set("includeTotal", "1");
  }

  return request(buildEmailsPath(address, "/emails", params, auth), EmailPage, {
    token: bearerToken(auth),
    bookmarkScope: getInboxBookmarkScope(address),
  });
}

export async function getEmail(address: string, emailId: string, auth: AuthDescriptor) {
  return request(
    buildEmailsPath(address, `/emails/${encodeURIComponent(emailId)}`, new URLSearchParams(), auth),
    EmailDetail,
    {
      token: bearerToken(auth),
      bookmarkScope: getInboxBookmarkScope(address),
    },
  );
}

export async function deleteEmail(address: string, emailId: string, auth: AuthDescriptor) {
  return request(
    buildEmailsPath(address, `/emails/${encodeURIComponent(emailId)}`, new URLSearchParams(), auth),
    OkResponse,
    {
      method: "DELETE",
      token: bearerToken(auth),
      bookmarkScope: getInboxBookmarkScope(address),
    },
  );
}

export async function downloadAttachment(address: string, emailId: string, attachmentId: string, auth: AuthDescriptor) {
  const path = buildEmailsPath(
    address,
    `/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
    new URLSearchParams(),
    auth,
  );

  const response = await fetchWithSession(path, {
    token: bearerToken(auth),
    bookmarkScope: getInboxBookmarkScope(address),
  });

  if (!response.ok) {
    const { code, message } = await parseError(response);
    throw new ApiError(message, response.status, code);
  }

  return response.blob();
}

export async function getRawEmailSource(address: string, emailId: string, auth: AuthDescriptor) {
  const path = buildEmailsPath(address, `/emails/${encodeURIComponent(emailId)}/raw`, new URLSearchParams(), auth);

  const response = await fetchWithSession(path, {
    token: bearerToken(auth),
    bookmarkScope: getInboxBookmarkScope(address),
  });

  if (!response.ok) {
    const { code, message } = await parseError(response);
    throw new ApiError(message, response.status, code);
  }

  return response.text();
}
