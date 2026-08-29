/**
 * VaultDocs Worker: serves static assets and provides a self-hosted
 * y-protocols signaling relay (subscribe/publish over WebSocket) via a
 * Durable Object. The relay only ever sees AES-GCM encrypted blobs.
 *
 * Minimal ambient types are declared here so the file compiles without
 * @cloudflare/workers-types installed.
 */

declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket };

interface Env {
  SIGNALING: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/signaling') {
      const id = env.SIGNALING.idFromName('global');
      return env.SIGNALING.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

interface SignalMessage {
  type: string;
  topics?: string[];
  topic?: string;
  data?: unknown;
}

export class SignalingServer {
  private sessions = new Map<WebSocket, Set<string>>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    server.accept();
    this.sessions.set(server, new Set());

    server.addEventListener('message', (event) => this.handleMessage(server, event));
    const drop = () => {
      this.sessions.delete(server);
    };
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
  }

  private handleMessage(sender: WebSocket, event: MessageEvent) {
    let msg: SignalMessage;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    const topics = this.sessions.get(sender);
    if (!topics) return;

    if (msg.type === 'subscribe' && Array.isArray(msg.topics)) {
      for (const t of msg.topics) topics.add(String(t));
    } else if (msg.type === 'unsubscribe' && Array.isArray(msg.topics)) {
      for (const t of msg.topics) topics.delete(String(t));
    } else if (msg.type === 'publish' && typeof msg.topic === 'string') {
      const out = JSON.stringify({ type: 'publish', topic: msg.topic, data: msg.data });
      for (const [ws, subs] of this.sessions) {
        if (subs.has(msg.topic)) {
          try {
            ws.send(out);
          } catch {
            this.sessions.delete(ws);
          }
        }
      }
    } else if (msg.type === 'ping') {
      try {
        sender.send(JSON.stringify({ type: 'pong' }));
      } catch {
        this.sessions.delete(sender);
      }
    }
  }
}
