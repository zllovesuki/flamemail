import { afterEach, vi } from "vitest";

export const fetchMock = vi.fn<typeof fetch>();
export const confirmMock = vi.fn(() => true);
export const clipboardWriteTextMock = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

export class MockWebSocket extends EventTarget implements WebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  extensions = "";
  onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, event: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, event: MessageEvent<unknown>) => unknown) | null = null;
  onopen: ((this: WebSocket, event: Event) => unknown) | null = null;
  protocol = "";
  readonly url: string;
  private currentReadyState = MockWebSocket.CONNECTING;

  readonly CONNECTING = MockWebSocket.CONNECTING;
  readonly OPEN = MockWebSocket.OPEN;
  readonly CLOSING = MockWebSocket.CLOSING;
  readonly CLOSED = MockWebSocket.CLOSED;

  get readyState() {
    return this.currentReadyState;
  }

  send = vi.fn<(data: string | ArrayBufferLike | Blob | ArrayBufferView) => void>();
  accept(_options?: WebSocketAcceptOptions) {}
  serializeAttachment(_attachment: unknown) {}
  deserializeAttachment() {
    return null;
  }
  close = vi.fn<(code?: number, reason?: string) => void>(() => {
    this.currentReadyState = MockWebSocket.CLOSED;
    const event = new CloseEvent("close");
    this.dispatchEvent(event);
    this.onclose?.call(this, event);
  });

  constructor(url: string | URL, _protocols?: string | string[]) {
    super();
    this.url = String(url);
  }

  open() {
    this.currentReadyState = MockWebSocket.OPEN;
    const event = new Event("open");
    this.dispatchEvent(event);
    this.onopen?.call(this, event);
  }

  receive(data: string) {
    const event = new MessageEvent("message", { data });
    this.dispatchEvent(event);
    this.onmessage?.call(this, event);
  }
}

vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("confirm", confirmMock);
vi.stubGlobal("WebSocket", MockWebSocket);

Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: clipboardWriteTextMock,
  },
});

afterEach(() => {
  fetchMock.mockReset();
  confirmMock.mockReset();
  confirmMock.mockReturnValue(true);
  clipboardWriteTextMock.mockReset();
  clipboardWriteTextMock.mockResolvedValue(undefined);
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
