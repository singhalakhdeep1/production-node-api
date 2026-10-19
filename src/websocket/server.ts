/**
 * Plain WebSocket endpoint on /ws for live todo updates and simple messaging.
 * Auth: `?token=<JWT>` / `?apiKey=` (browsers cannot set headers) or the Authorization /
 * X-API-Key headers. Messages (JSON): ping, broadcast, direct {userId}, presence.
 * Broadcast/direct messages are fanned out through Redis so users on other workers get them.
 */
import type { IncomingMessage } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { cache } from '../cache/redis';
import { config } from '../config';
import { onTodoEvent } from '../events';
import { authenticateApiKey, authenticateToken, type Principal } from '../middleware/auth';
import { websocketConnections } from '../metrics';
import { logger } from '../services/structured-logging/structured-logging.service';

interface Client extends WebSocket {
  user: Principal;
  isAlive: boolean;
}

interface Envelope {
  kind: 'broadcast' | 'direct';
  fromUserId: string;
  toUserId?: string;
  data: unknown;
  origin: string;
}

const CHANNEL = 'events:ws';
const MAX_MESSAGE_BYTES = 16 * 1024;

export class AppWebSocketServer {
  readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private clients = new Map<string, Set<Client>>();
  private heartbeat: NodeJS.Timeout;
  private redisFanout = false;

  constructor() {
    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage, user: Principal) => this.onConnection(ws as Client, user));
    this.heartbeat = setInterval(() => this.sweep(), 30000);
    this.heartbeat.unref();

    onTodoEvent((event) => this.sendToUser(event.userId, { type: `todo_${event.type}`, todo: event.todo, at: event.at }));
  }

  async init(): Promise<void> {
    this.redisFanout = await cache.subscribe(CHANNEL, (message) => {
      const envelope = JSON.parse(message) as Envelope;
      this.deliver(envelope);
    });
  }

  /** Authenticates an upgrade request before the WebSocket handshake completes. */
  async authenticate(req: IncomingMessage): Promise<Principal | null> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const apiKey = url.searchParams.get('apiKey') ?? (req.headers['x-api-key'] as string | undefined);
    if (apiKey) return (await authenticateApiKey(apiKey))?.principal ?? null;
    return authenticateToken(url.searchParams.get('token') ?? req.headers.authorization);
  }

  private onConnection(ws: Client, user: Principal): void {
    ws.user = user;
    ws.isAlive = true;
    const set = this.clients.get(user.id) ?? new Set<Client>();
    set.add(ws);
    this.clients.set(user.id, set);
    websocketConnections.inc({ endpoint: '/ws' });

    this.send(ws, { type: 'connected', message: 'WebSocket connected successfully', userId: user.id, instance: config.instance });
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => this.handleMessage(ws, data));
    ws.on('close', () => {
      set.delete(ws);
      if (set.size === 0) this.clients.delete(user.id);
      websocketConnections.dec({ endpoint: '/ws' });
    });
    ws.on('error', (error) => logger.warn('WebSocket error', { error: error.message, userId: user.id }));
  }

  private handleMessage(ws: Client, data: WebSocket.RawData): void {
    let message: { type?: string; data?: unknown; userId?: string };
    try {
      message = JSON.parse(data.toString());
    } catch {
      return this.send(ws, { type: 'error', message: 'Invalid message format' });
    }
    switch (message.type) {
      case 'ping':
        return this.send(ws, { type: 'pong', at: new Date().toISOString() });
      case 'broadcast':
        return void this.route({ kind: 'broadcast', fromUserId: ws.user.id, data: message.data, origin: config.instance });
      case 'direct':
        if (typeof message.userId !== 'string') return this.send(ws, { type: 'error', message: 'direct requires userId' });
        return void this.route({ kind: 'direct', fromUserId: ws.user.id, toUserId: message.userId, data: message.data, origin: config.instance });
      case 'presence':
        return this.send(ws, { type: 'presence', localUsers: this.getUserCount(), localConnections: this.getConnectionCount() });
      default:
        return this.send(ws, { type: 'error', message: 'Unknown message type' });
    }
  }

  private async route(envelope: Envelope): Promise<void> {
    if (this.redisFanout && (await cache.publish(CHANNEL, JSON.stringify(envelope)))) return;
    this.deliver(envelope);
  }

  private deliver(envelope: Envelope): void {
    const payload = { type: envelope.kind, from: envelope.fromUserId, data: envelope.data, timestamp: new Date().toISOString() };
    if (envelope.kind === 'direct' && envelope.toUserId) return this.sendToUser(envelope.toUserId, payload);
    for (const [userId, sockets] of this.clients) {
      if (userId === envelope.fromUserId) continue;
      sockets.forEach((s) => this.send(s, payload));
    }
  }

  sendToUser(userId: string, payload: unknown): void {
    this.clients.get(userId)?.forEach((s) => this.send(s, payload));
  }

  private send(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  private sweep(): void {
    for (const sockets of this.clients.values()) {
      for (const ws of sockets) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }

  getConnectedUsers(): string[] {
    return [...this.clients.keys()];
  }

  getUserCount(): number {
    return this.clients.size;
  }

  getConnectionCount(): number {
    let n = 0;
    for (const s of this.clients.values()) n += s.size;
    return n;
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const sockets of this.clients.values()) sockets.forEach((s) => s.close(1001, 'Server shutting down'));
    this.wss.close();
  }
}

export const appWebSocketServer = new AppWebSocketServer();

export const websocketStats = () => ({
  users: appWebSocketServer.getUserCount(),
  connections: appWebSocketServer.getConnectionCount(),
});
