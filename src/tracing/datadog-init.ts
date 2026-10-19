/**
 * Must be the first import of the server entrypoint: dd-trace patches modules (express, pg,
 * redis, http) as they are required, so it has to load before them. No-op unless
 * DD_TRACE_ENABLED=true. Standard DD_* env vars (DD_AGENT_HOST, DD_TRACE_AGENT_PORT,
 * DD_DOGSTATSD_PORT, DD_SERVICE, DD_ENV, DD_VERSION) are honoured by dd-trace itself.
 */
import 'dotenv/config';
import type { Tracer } from 'dd-trace';

export let ddTracer: Tracer | null = null;

if (['1', 'true', 'yes', 'on'].includes((process.env.DD_TRACE_ENABLED ?? '').toLowerCase())) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ddtrace = require('dd-trace') as Tracer;
  ddTracer = ddtrace.init({
    service: process.env.DD_SERVICE ?? process.env.SERVICE_NAME ?? 'production-api',
    env: process.env.DD_ENV ?? process.env.NODE_ENV ?? 'development',
    version: process.env.DD_VERSION ?? process.env.APP_VERSION ?? '2.0.0',
    logInjection: true,
    runtimeMetrics: true,
  });
}
