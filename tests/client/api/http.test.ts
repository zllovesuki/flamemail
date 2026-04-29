import { describe, expect, it, vi } from "vitest";
import { ADMIN_ACCESS_DISABLED_ERROR_CODE } from "@/shared/contracts";
import { D1_BOOKMARK_HEADER } from "@/shared/d1";
import { getStoredBookmark, setStoredBookmark } from "@/client/lib/api/bookmarks";
import { fetchWithSession, parseError, request } from "@/client/lib/api/http";
import { fetchMock } from "../../setup/client";

describe("client api http helpers", () => {
  it("adds the authorization header when a token is provided", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    await fetchWithSession("/api/test", {
      token: "tok_user",
    });

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestInit).toBeDefined();
    expect((requestInit?.headers as Headers).get("authorization")).toBe("Bearer tok_user");
  });

  it("sends a stored bookmark and applies the response bookmark", async () => {
    setStoredBookmark("inbox:reader@mail.test", "bookmark-before");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
          [D1_BOOKMARK_HEADER]: "bookmark-after",
        },
      }),
    );
    const onBookmark = vi.fn<(bookmark: string | null) => void>();

    await fetchWithSession("/api/test", {
      bookmarkScope: "inbox:reader@mail.test",
      onBookmark,
    });

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestInit).toBeDefined();
    expect((requestInit?.headers as Headers).get(D1_BOOKMARK_HEADER)).toBe("bookmark-before");
    expect(getStoredBookmark("inbox:reader@mail.test")).toBe("bookmark-after");
    expect(onBookmark).toHaveBeenCalledWith("bookmark-after");
  });

  it("parses structured api errors", async () => {
    const response = new Response(
      JSON.stringify({
        error: "Forbidden",
        code: ADMIN_ACCESS_DISABLED_ERROR_CODE,
      }),
      {
        status: 503,
        statusText: "Service Unavailable",
        headers: {
          "content-type": "application/json",
        },
      },
    );

    await expect(parseError(response)).resolves.toEqual({
      code: ADMIN_ACCESS_DISABLED_ERROR_CODE,
      message: "Forbidden",
    });
  });

  it("falls back to the response status text for non-structured errors", async () => {
    const response = new Response("broken", {
      status: 500,
      statusText: "Server exploded",
      headers: {
        "content-type": "text/plain",
      },
    });

    await expect(parseError(response)).resolves.toEqual({
      message: "500 Server exploded",
    });
  });

  it("requests json payloads and decodes successful responses", async () => {
    const decoder = {
      assertDecode: vi.fn((value: unknown) => value as { ok: boolean }),
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const payload = await request("/api/test", decoder, {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
    });

    expect(payload).toEqual({ ok: true });
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestInit).toBeDefined();
    expect((requestInit?.headers as Headers).get("accept")).toBe("application/json");
    expect((requestInit?.headers as Headers).get("content-type")).toBe("application/json");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(JSON.stringify({ hello: "world" }));
    expect(decoder.assertDecode).toHaveBeenCalledWith({ ok: true });
  });
});
