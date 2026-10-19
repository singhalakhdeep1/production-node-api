// dd-trace must be loaded before anything it instruments.
import './tracing/datadog-init';

import http from 'node:http';
import type { Duplex } from 'node:stream';
import { flushMonitoring, initMonitoring } from '../monitoring';
import { createApp } from './app';
import { cache } from './cache/redis';
import { config } from './config';
import { pool } from './db/pool';
import { runMigrations } from './db/migrate';
import { initEventBus } from './events';
import './health';
import { startApolloServer, graphqlWss } from './graphql/server';
import { errorHandler, notFound } from './middleware/error';
import { circuitBreakerState } from './metrics';
import { CircuitBreakerService } from './services/circuit-breaker/circuit-breaker.service';
import { logger } from './services/structured-logging/structured-logging.service';
import { appWebSocketServer } from './websocket/server';

const STATE_VALUE = { closed: 0, 'half-open': 1, open: 2 } as const;

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

async function main(): Promise<void> {
  initMonitoring();

  // Publish breaker state as a gauge and log every transition.
  const watchBreakers = () => {
    for (const breaker of CircuitBreakerService.all()) {
      circuitBreakerState.set({ breaker: breaker.name }, STATE_VALUE[breaker.getState()]);
      if (!breaker.listenerCount('stateChange')) {
        breaker.on('stateChange', ({ name, from, to }) => logger.warn(`Circuit breaker ${name}: ${from} -> ${to}`, { breaker: name, from, to }));
      }
    }
  };
  watchBreakers();
  setInterval(watchBreakers, 5000).unref();

  if (process.env.RUN_MIGRATIONS !== 'false') {
    const applied = await runMigrations();
    if (applied.length) logger.info(`Applied migrations: ${applied.join(', ')}`);
  }

  await cache.connect();
  await initEventBus();
  await appWebSocketServer.init();

  const app = createApp();
  const server = http.createServer(app);
  server.keepAliveTimeout = 65000; // longer than typical LB idle timeouts (nginx 60s)
  server.headersTimeout = 66000;

  await startApolloServer(app, server);
  app.use(notFound);
  app.use(errorHandler);

  // Two WebSocket endpoints share the HTTP server; route upgrades by path.
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/graphql') {
      graphqlWss.handleUpgrade(req, socket, head, (ws) => graphqlWss.emit('connection', ws, req));
    } else if (pathname === '/ws') {
      appWebSocketServer
        .authenticate(req)
        .then((user) => {
          if (!user) return rejectUpgrade(socket, 401, 'Unauthorized');
          appWebSocketServer.wss.handleUpgrade(req, socket, head, (ws) => appWebSocketServer.wss.emit('connection', ws, req, user));
        })
        .catch(() => rejectUpgrade(socket, 500, 'Internal Server Error'));
    } else {
      rejectUpgrade(socket, 404, 'Not Found');
    }
  });

  server.listen(config.port, () => {
    logger.info(`Production server running on port ${config.port}`, { env: config.env, instance: config.instance });
    // PM2 waits for this when wait_ready is set (graceful reloads).
    process.send?.('ready');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received: draining connections`);
    const force = setTimeout(() => process.exit(1), 10000);
    force.unref();
    appWebSocketServer.close();
    server.close(async () => {
      await flushMonitoring();
      await cache.disconnect();
      await pool.end().catch(() => undefined);
      logger.info('Shutdown complete');
      process.exit(0);
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('message', (msg) => {
    if (msg === 'shutdown') void shutdown('PM2 shutdown');
  });
}

process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', { error: String(reason) }));

main().catch((error) => {
  logger.error('Failed to start server', { error: (error as Error).message, stack: (error as Error).stack });
  process.exit(1);
});
