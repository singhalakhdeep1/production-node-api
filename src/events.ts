/**
 * Todo change events. Published on a Redis channel so every PM2 worker / replica receives
 * them (the WebSocket and GraphQL subscription clients may be connected to another process);
 * falls back to in-process delivery when Redis is not configured.
 */
import { EventEmitter } from 'node:events';
import { cache } from './cache/redis';
import { config } from './config';
import type { Todo } from './models/todo';

export type TodoEventType = 'created' | 'updated' | 'deleted';
export interface TodoEvent {
  type: TodoEventType;
  todo: Todo;
  userId: string;
  at: string;
  origin: string;
}

const CHANNEL = 'events:todos';
const local = new EventEmitter();
local.setMaxListeners(0);
let redisFanout = false;

export async function initEventBus(): Promise<void> {
  redisFanout = await cache.subscribe(CHANNEL, (message) => {
    local.emit('todo', JSON.parse(message) as TodoEvent);
  });
}

export async function publishTodoEvent(type: TodoEventType, todo: Todo): Promise<void> {
  const event: TodoEvent = { type, todo, userId: todo.userId, at: new Date().toISOString(), origin: config.instance };
  if (redisFanout && (await cache.publish(CHANNEL, JSON.stringify(event)))) return;
  local.emit('todo', event);
}

export function onTodoEvent(listener: (event: TodoEvent) => void): () => void {
  local.on('todo', listener);
  return () => local.off('todo', listener);
}

export const eventBusMode = () => (redisFanout ? 'redis' : 'local');
