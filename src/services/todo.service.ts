/**
 * Todo use cases shared by REST, GraphQL and WebSocket handlers:
 * ownership checks, cache-aside reads, tag invalidation on writes, change events.
 */
import { cache } from '../cache/redis';
import { publishTodoEvent } from '../events';
import { HttpError } from '../http-error';
import { todosCreated } from '../metrics';
import { TodoModel, type Todo, type TodoListOptions } from '../models/todo';

const LIST_TTL = 60;
const ITEM_TTL = 300;
const tagFor = (userId: string) => `todos:user:${userId}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertId = (id: string) => {
  if (!UUID.test(id)) throw new HttpError(404, 'Todo not found');
};

export const TodoService = {
  async list(userId: string, options: TodoListOptions) {
    const key = `${tagFor(userId)}:list:${options.completed ?? 'all'}:${options.search ?? ''}:${options.sort}:${options.order}:${options.limit}:${options.offset}`;
    const { value, cached } = await cache.wrap(key, LIST_TTL, [tagFor(userId)], () => TodoModel.findByUserId(userId, options));
    return { ...value, limit: options.limit, offset: options.offset, cached };
  },

  async get(userId: string, id: string): Promise<{ todo: Todo; cached: boolean }> {
    assertId(id);
    const key = `${tagFor(userId)}:item:${id}`;
    const { value, cached } = await cache.wrap(key, ITEM_TTL, [tagFor(userId)], () => TodoModel.findById(id, userId));
    if (!value) {
      await cache.del(key);
      throw new HttpError(404, 'Todo not found');
    }
    return { todo: value, cached };
  },

  async stats(userId: string) {
    const { value } = await cache.wrap(`${tagFor(userId)}:stats`, LIST_TTL, [tagFor(userId)], () => TodoModel.stats(userId));
    return value;
  },

  async create(userId: string, input: { title: string; description?: string | null; completed?: boolean }): Promise<Todo> {
    const todo = await TodoModel.create({ ...input, userId });
    todosCreated.inc();
    await cache.invalidateTag(tagFor(userId));
    await publishTodoEvent('created', todo);
    return todo;
  },

  async update(userId: string, id: string, patch: { title?: string; description?: string | null; completed?: boolean }): Promise<Todo> {
    assertId(id);
    const todo = await TodoModel.update(id, userId, patch);
    if (!todo) throw new HttpError(404, 'Todo not found');
    await cache.invalidateTag(tagFor(userId));
    await publishTodoEvent('updated', todo);
    return todo;
  },

  async remove(userId: string, id: string): Promise<void> {
    assertId(id);
    const existing = await TodoModel.findById(id, userId);
    if (!existing || !(await TodoModel.delete(id, userId))) throw new HttpError(404, 'Todo not found');
    await cache.invalidateTag(tagFor(userId));
    await publishTodoEvent('deleted', existing);
  },
};
