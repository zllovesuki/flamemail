import { EmailDetail, EmailPage, OkResponse } from "@/shared/contracts";
import { getInboxBookmarkScope } from "./bookmarks";
import { fetchWithSession, parseError, request, ApiError } from "./http";

export async function listEmails(
  address: string,
  token: string,
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

  return request(`/api/protected/inboxes/${encodeURIComponent(address)}/emails?${params.toString()}`, EmailPage, {
    token,
    bookmarkScope: getInboxBookmarkScope(address),
  });
}

export async function getEmail(address: string, emailId: string, token: string) {
  return request(
    `/api/protected/inboxes/${encodeURIComponent(address)}/emails/${encodeURIComponent(emailId)}`,
    EmailDetail,
    {
      token,
      bookmarkScope: getInboxBookmarkScope(address),
    },
  );
}

export async function deleteEmail(address: string, emailId: string, token: string) {
  return request(
    `/api/protected/inboxes/${encodeURIComponent(address)}/emails/${encodeURIComponent(emailId)}`,
    OkResponse,
    {
      method: "DELETE",
      token,
      bookmarkScope: getInboxBookmarkScope(address),
    },
  );
}

export async function downloadAttachment(address: string, emailId: string, attachmentId: string, token: string) {
  const response = await fetchWithSession(
    `/api/protected/inboxes/${encodeURIComponent(address)}/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      token,
      bookmarkScope: getInboxBookmarkScope(address),
    },
  );

  if (!response.ok) {
    const { code, message } = await parseError(response);
    throw new ApiError(message, response.status, code);
  }

  return response.blob();
}

export async function getRawEmailSource(address: string, emailId: string, token: string) {
  const response = await fetchWithSession(
    `/api/protected/inboxes/${encodeURIComponent(address)}/emails/${encodeURIComponent(emailId)}/raw`,
    {
      token,
      bookmarkScope: getInboxBookmarkScope(address),
    },
  );

  if (!response.ok) {
    const { code, message } = await parseError(response);
    throw new ApiError(message, response.status, code);
  }

  return response.text();
}
