/**
 * Apollo Server 5 on /graphql (HTTP) plus graphql-ws subscriptions on the same path (WebSocket).
 * HTTP auth: Bearer JWT or X-API-Key header. WS auth: connectionParams.authorization / apiKey.
 */
import { ApolloServer, type ApolloServerPlugin } from '@apollo/server';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { expressMiddleware } from '@as-integrations/express4';
import { makeExecutableSchema } from '@graphql-tools/schema';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { useServer } from 'graphql-ws/use/ws';
import { WebSocketServer } from 'ws';
import { config } from '../config';
import { authenticateApiKey, authenticateToken, resolvePrincipal, type Principal } from '../middleware/auth';
import { graphqlOperations, websocketConnections } from '../metrics';
import { UserModel, type User } from '../models/user';
import { tracer } from '../tracing/tracer';
import { resolvers, type GraphQLContext } from './resolvers';
import { typeDefs } from './schema';

export const graphqlWss = new WebSocketServer({ noServer: true });
let activeSubscriptionSockets = 0;

/** Per-request batching loader so `todos { user }` costs one users query, not N. */
function userLoader(): GraphQLContext['loaders']['user'] {
  const cache = new Map<string, Promise<User | null>>();
  let pending: { id: string; resolve: (u: User | null) => void; reject: (e: unknown) => void }[] = [];
  const dispatch = async () => {
    const batch = pending;
    pending = [];
    try {
      const users = await UserModel.findByIds([...new Set(batch.map((b) => b.id))]);
      const byId = new Map(users.map((u) => [u.id, u]));
      batch.forEach((b) => b.resolve(byId.get(b.id) ?? null));
    } catch (error) {
      batch.forEach((b) => b.reject(error));
    }
  };
  return (id) => {
    let promise = cache.get(id);
    if (!promise) {
      promise = new Promise((resolve, reject) => {
        if (pending.length === 0) queueMicrotask(() => void dispatch());
        pending.push({ id, resolve, reject });
      });
      cache.set(id, promise);
    }
    return promise;
  };
}

const metricsPlugin: ApolloServerPlugin<GraphQLContext> = {
  async requestDidStart() {
    const span = tracer.startSpan('graphql.request');
    return {
      async didResolveOperation(ctx) {
        span.setAttribute('graphql.operation.type', ctx.operation?.operation ?? 'unknown').setAttribute('graphql.operation.name', ctx.operationName ?? 'anonymous');
      },
      async willSendResponse(ctx) {
        const success = !ctx.errors?.length;
        graphqlOperations.inc({ type: ctx.operation?.operation ?? 'unknown', operation: ctx.operationName ?? 'anonymous', success: String(success) });
        span.end(success ? undefined : ctx.errors?.[0]);
      },
    };
  },
};

export async function startApolloServer(app: Express, httpServer: Server): Promise<ApolloServer<GraphQLContext>> {
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const serverCleanup = useServer<Record<string, unknown>, { user: Principal | null }>(
    {
      schema,
      onConnect: async (ctx) => {
        const params = ctx.connectionParams ?? {};
        const apiKey = typeof params.apiKey === 'string' ? params.apiKey : undefined;
        const auth = typeof params.authorization === 'string' ? params.authorization : undefined;
        const user = apiKey ? (await authenticateApiKey(apiKey))?.principal ?? null : await authenticateToken(auth);
        if (!user) return false; // closes with 4403 Forbidden
        ctx.extra.user = user;
        activeSubscriptionSockets++;
        websocketConnections.inc({ endpoint: '/graphql' });
        return true;
      },
      onClose: (ctx) => {
        if (ctx.extra.user) {
          activeSubscriptionSockets--;
          websocketConnections.dec({ endpoint: '/graphql' });
        }
      },
      context: (ctx) => ({ user: ctx.extra.user ?? null, loaders: { user: userLoader() } }),
      onSubscribe: (_ctx, _id, payload) => {
        graphqlOperations.inc({ type: 'subscription', operation: payload.operationName ?? 'anonymous', success: 'true' });
      },
    },
    graphqlWss,
  );

  const server = new ApolloServer<GraphQLContext>({
    schema,
    introspection: true,
    csrfPrevention: true,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
      metricsPlugin,
      ...(config.isProduction ? [ApolloServerPluginLandingPageDisabled()] : []),
    ],
  });
  await server.start();

  app.use(
    '/graphql',
    express.json({ limit: '1mb' }),
    expressMiddleware(server, {
      context: async ({ req }) => {
        const result = await resolvePrincipal(req.headers);
        return { user: result?.principal ?? null, loaders: { user: userLoader() } };
      },
    }),
  );
  return server;
}

export const graphqlStats = () => ({ subscriptionSockets: activeSubscriptionSockets });
