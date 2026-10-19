import { GraphQLError } from 'graphql';
import { PubSub, withFilter } from 'graphql-subscriptions';
import { generateToken } from '../auth/jwt';
import { HttpError } from '../http-error';
import { hasScope, type Principal } from '../middleware/auth';
import type { Todo } from '../models/todo';
import { UserModel, type User } from '../models/user';
import { onTodoEvent, type TodoEvent } from '../events';
import { TodoService } from '../services/todo.service';
import { structuredLogger } from '../services/structured-logging/structured-logging.service';
import { todoSchemas, userSchemas, validateWith } from '../validation/schemas';

export interface GraphQLContext {
  user: Principal | null;
  loaders: { user: (id: string) => Promise<User | null> };
}

export const pubsub = new PubSub<{ TODO_UPDATED: { todoUpdated: TodoEvent } }>();
// Bridge the cross-worker event bus into the GraphQL PubSub of this process.
onTodoEvent((event) => void pubsub.publish('TODO_UPDATED', { todoUpdated: event }));

const toGraphQLError = (error: unknown): never => {
  if (error instanceof HttpError) {
    const code = { 400: 'BAD_USER_INPUT', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' }[error.status] ?? 'INTERNAL_SERVER_ERROR';
    throw new GraphQLError(error.message, { extensions: { code, details: error.details } });
  }
  throw error;
};

const guard = <A, R>(scope: string, fn: (user: Principal, args: A, ctx: GraphQLContext) => Promise<R>) =>
  async (_: unknown, args: A, ctx: GraphQLContext): Promise<R> => {
    if (!ctx.user) throw new GraphQLError('Not authenticated', { extensions: { code: 'UNAUTHENTICATED' } });
    if (!hasScope(ctx.user, scope)) throw new GraphQLError(`Missing scope: ${scope}`, { extensions: { code: 'FORBIDDEN' } });
    try {
      return await fn(ctx.user, args, ctx);
    } catch (error) {
      return toGraphQLError(error);
    }
  };

export const resolvers = {
  Query: {
    me: async (_: unknown, __: unknown, ctx: GraphQLContext) => (ctx.user ? UserModel.findById(ctx.user.id) : null),
    todos: guard('read', (user, args: { completed?: boolean; search?: string; limit?: number; offset?: number }) => {
      const options = validateWith(todoSchemas.list, args);
      return TodoService.list(user.id, options);
    }),
    todo: guard('read', async (user, { id }: { id: string }) => {
      try {
        return (await TodoService.get(user.id, id)).todo;
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      }
    }),
    todoStats: guard('read', (user) => TodoService.stats(user.id)),
  },

  Mutation: {
    register: async (_: unknown, args: { email: string; password: string; name: string }) => {
      try {
        const user = await UserModel.create(validateWith(userSchemas.register, args));
        structuredLogger.logAuditEvent('UserRegistered', 'User registered (GraphQL)', { userId: user.id });
        return { token: generateToken(user), user };
      } catch (error) {
        return toGraphQLError(error);
      }
    },
    login: async (_: unknown, args: { email: string; password: string }) => {
      try {
        const input = validateWith(userSchemas.login, args);
        const user = await UserModel.authenticate(input.email, input.password);
        structuredLogger.logAuditEvent('UserLoggedIn', 'User logged in (GraphQL)', { userId: user.id });
        return { token: generateToken(user), user };
      } catch (error) {
        return toGraphQLError(error);
      }
    },
    createTodo: guard('write', (user, args: { title: string; description?: string; completed?: boolean }) =>
      TodoService.create(user.id, validateWith(todoSchemas.create, args))),
    updateTodo: guard('write', (user, { id, ...patch }: { id: string; title?: string; description?: string; completed?: boolean }) =>
      TodoService.update(user.id, id, validateWith(todoSchemas.update, patch))),
    deleteTodo: guard('write', async (user, { id }: { id: string }) => {
      await TodoService.remove(user.id, id);
      return true;
    }),
  },

  Subscription: {
    todoUpdated: {
      subscribe: withFilter(
        (_: unknown, __: unknown, ctx?: GraphQLContext) => {
          if (!ctx?.user) throw new GraphQLError('Not authenticated', { extensions: { code: 'UNAUTHENTICATED' } });
          return pubsub.asyncIterableIterator('TODO_UPDATED');
        },
        (payload: unknown, _: unknown, ctx?: GraphQLContext) => (payload as { todoUpdated?: TodoEvent } | undefined)?.todoUpdated?.userId === ctx?.user?.id,
      ),
    },
  },

  Todo: {
    user: (todo: Todo, _: unknown, ctx: GraphQLContext) => ctx.loaders.user(todo.userId),
  },
};
