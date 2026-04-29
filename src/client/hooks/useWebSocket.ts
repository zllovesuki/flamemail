import { useEffect, useRef, useState } from "react";
import { createWebSocketTicket, type AuthDescriptor } from "@/client/lib/api";

type SocketState = "idle" | "connecting" | "open" | "closed" | "error";

interface Decoder<T> {
  assertDecode(value: unknown): T;
}

interface UseWebSocketOptions<TMessage> {
  address: string;
  auth: AuthDescriptor | null;
  enabled: boolean;
  messageCodec: Decoder<TMessage>;
  onMessage?: (message: TMessage) => void;
}

export function useWebSocket<TMessage>({
  address,
  auth,
  enabled,
  messageCodec,
  onMessage,
}: UseWebSocketOptions<TMessage>) {
  const callbackRef = useRef(onMessage);
  const [status, setStatus] = useState<SocketState>(enabled && auth ? "connecting" : "idle");

  // Reduce auth to a stable key so callers passing freshly-allocated
  // descriptor objects on each render do not retrigger the connect
  // effect. The descriptor itself is reconstructed inside the effect.
  const authMode = auth?.mode ?? "none";
  const userToken = auth?.mode === "user" ? auth.token : "";

  useEffect(() => {
    callbackRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!enabled || authMode === "none") {
      setStatus("idle");
      return;
    }
    const effectiveAuth: AuthDescriptor = authMode === "user" ? { mode: "user", token: userToken } : { mode: "admin" };

    let closedByHook = false;
    let reconnectDelay = 1_000;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let socket: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (closedByHook) {
        return;
      }

      setStatus("closed");
      reconnectTimer = window.setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 1.8, 10_000);
        void connect();
      }, reconnectDelay);
    };

    const connect = async () => {
      setStatus("connecting");

      try {
        const { ticket } = await createWebSocketTicket(address, effectiveAuth);
        if (closedByHook) {
          return;
        }

        const scheme = window.location.protocol === "https:" ? "wss" : "ws";
        socket = new WebSocket(
          `${scheme}://${window.location.host}/ws?address=${encodeURIComponent(address)}&ticket=${encodeURIComponent(ticket)}`,
        );

        socket.addEventListener("open", () => {
          reconnectDelay = 1_000;
          setStatus("open");
          heartbeatTimer = window.setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send("ping");
            }
          }, 25_000);
        });

        socket.addEventListener("message", (event) => {
          try {
            const payload = messageCodec.assertDecode(JSON.parse(event.data as string));
            callbackRef.current?.(payload);
          } catch {
            // Ignore malformed payloads.
          }
        });

        socket.addEventListener("close", () => {
          if (heartbeatTimer) {
            window.clearInterval(heartbeatTimer);
          }

          if (closedByHook) {
            setStatus("closed");
            return;
          }

          scheduleReconnect();
        });

        socket.addEventListener("error", () => {
          setStatus("error");
        });
      } catch {
        if (closedByHook) {
          return;
        }

        setStatus("error");
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      closedByHook = true;

      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }

      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
      }

      socket?.close();
    };
  }, [address, authMode, userToken, enabled, messageCodec]);

  return status;
}
