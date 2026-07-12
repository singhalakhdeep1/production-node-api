const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { ApolloServerPluginDrainHttpServer } = require('@apollo/server/plugin/drainHttpServer');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { WebSocketServer } = require('ws');
const { useServer } = require('graphql-ws/lib/use/ws');
const express = require('express');
const http = require('http');
const typeDefs = require('./schema');
const resolvers = require('./resolvers');
const { authenticateToken } = require('../middleware/auth');
const { PubSub } = require('graphql-subscriptions');

const pubsub = new PubSub();

async function startApolloServer(app, httpServer) {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers
  });

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql'
  });

  const serverCleanup = useServer(
    {
      schema,
      context: async (ctx) => {
        const token = ctx.connectionParams?.authorization;
        const user = token ? await authenticateToken(token) : null;
        return { user, pubsub };
      },
      onConnect: async (ctx) => {
        console.log('WebSocket connected');
      },
      onDisconnect: () => {
        console.log('WebSocket disconnected');
      }
    },
    wsServer
  );

  const server = new ApolloServer({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            }
          };
        }
      }
    ],
    context: async ({ req }) => {
      const token = req.headers.authorization || '';
      const user = token ? await authenticateToken(token) : null;
      return { user, pubsub };
    }
  });

  await server.start();

  app.use(
    '/graphql',
    express.json(),
    expressMiddleware(server)
  );

  return server;
}

module.exports = { startApolloServer, pubsub };
