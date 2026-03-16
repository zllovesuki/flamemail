import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocket } from "@/client/hooks/useWebSocket";
import { MockWebSocket } from "../../setup/client";

const { createWebSocketTicketMock } = vi.hoisted(() => ({
  createWebSocketTicketMock: vi.fn(),
}));

vi.mock("@/client/lib/api", () => ({
  createWebSocketTicket: createWebSocketTicketMock,
}));

class TrackingWebSocket extends MockWebSocket {
  static instances: TrackingWebSocket[] = [];

  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    TrackingWebSocket.instances.push(this);
  }
}

function decoder<T>() {
  return {
    assertDecode: vi.fn((value: unknown) => value as T),
  };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useWebSocket", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    createWebSocketTicketMock.mockReset();
    TrackingWebSocket.instances = [];
    vi.stubGlobal("WebSocket", TrackingWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays idle when disabled", () => {
    const { result } = renderHook(() =>
      useWebSocket({
        address: "reader@mail.test",
        token: "tok_user",
        enabled: false,
        messageCodec: decoder<{ ok: true }>(),
      }),
    );

    expect(result.current).toBe("idle");
    expect(createWebSocketTicketMock).not.toHaveBeenCalled();
  });

  it("requests a websocket ticket before connecting", async () => {
    createWebSocketTicketMock.mockResolvedValueOnce({
      ticket: "wst_123",
    });

    renderHook(() =>
      useWebSocket({
        address: "reader@mail.test",
        token: "tok_user",
        enabled: true,
        messageCodec: decoder<{ ok: true }>(),
      }),
    );

    await flushAsyncWork();

    expect(createWebSocketTicketMock).toHaveBeenCalledWith("reader@mail.test", "tok_user");
    expect(TrackingWebSocket.instances).toHaveLength(1);
    expect(TrackingWebSocket.instances[0]?.url).toContain("/ws?address=reader%40mail.test&ticket=wst_123");
  });

  it("transitions to open and sends heartbeat pings", async () => {
    createWebSocketTicketMock.mockResolvedValueOnce({
      ticket: "wst_123",
    });
    const onMessage = vi.fn<(message: { type: string }) => void>();
    const messageCodec = decoder<{ type: string }>();
    const { result } = renderHook(() =>
      useWebSocket({
        address: "reader@mail.test",
        token: "tok_user",
        enabled: true,
        messageCodec,
        onMessage,
      }),
    );

    await flushAsyncWork();

    vi.useFakeTimers();
    act(() => {
      TrackingWebSocket.instances[0]?.open();
    });

    expect(result.current).toBe("open");

    act(() => {
      TrackingWebSocket.instances[0]?.receive(JSON.stringify({ type: "new_email" }));
    });

    expect(onMessage).toHaveBeenCalledWith({ type: "new_email" });

    act(() => {
      vi.advanceTimersByTime(25_000);
    });

    expect(TrackingWebSocket.instances[0]?.send).toHaveBeenCalledWith("ping");
  });

  it("ignores malformed message payloads", async () => {
    createWebSocketTicketMock.mockResolvedValueOnce({
      ticket: "wst_123",
    });
    const onMessage = vi.fn();
    const messageCodec = {
      assertDecode: vi.fn(() => {
        throw new Error("invalid payload");
      }),
    };

    renderHook(() =>
      useWebSocket({
        address: "reader@mail.test",
        token: "tok_user",
        enabled: true,
        messageCodec,
        onMessage,
      }),
    );

    await flushAsyncWork();

    act(() => {
      TrackingWebSocket.instances[0]?.receive('{"broken":true}');
    });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it("schedules reconnect after close", async () => {
    createWebSocketTicketMock
      .mockResolvedValueOnce({ ticket: "wst_first" })
      .mockResolvedValueOnce({ ticket: "wst_second" });
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    renderHook(() =>
      useWebSocket({
        address: "reader@mail.test",
        token: "tok_user",
        enabled: true,
        messageCodec: decoder<{ ok: true }>(),
      }),
    );

    await flushAsyncWork();

    act(() => {
      TrackingWebSocket.instances[0]?.dispatchEvent(new Event("close"));
    });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });
});
