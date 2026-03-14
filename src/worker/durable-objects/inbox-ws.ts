import { DurableObject } from "cloudflare:workers";
import type { NewEmailNotification } from "@/shared/contracts";

export class InboxWebSocket extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async notifyNewEmail(payload: NewEmailNotification): Promise<void> {
    this.broadcast(JSON.stringify({ type: "new_email", ...payload }));
  }

  async fetch(request: Request) {
    if (request.headers.get("upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const url = new URL(request.url);
      const address = url.searchParams.get("address") ?? "unknown";

      this.ctx.acceptWebSocket(server, [address]);
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response("Expected WebSocket upgrade", { status: 400 });
  }

  private broadcast(message: string) {
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(message);
    }
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string" && message === "ping") {
      return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket) {
    ws.close(1011, "WebSocket error");
  }
}
