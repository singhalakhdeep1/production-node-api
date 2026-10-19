/**
 * PM2 ECOSYSTEM CONFIGURATION
 * Cluster mode across CPU cores, graceful zero-downtime reloads (`pm2 reload`), memory cap.
 * The app signals readiness with process.send('ready') once migrations, Redis and the HTTP
 * listener are up (wait_ready), and drains connections on SIGINT/'shutdown' (kill_timeout).
 */
module.exports = {
  apps: [{
    name: 'production-api',
    script: './dist/src/server.js',
    instances: process.env.PM2_INSTANCES || 'max',
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || '500M',
    wait_ready: true,
    listen_timeout: 15000,
    kill_timeout: 12000,
    shutdown_with_message: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    exp_backoff_restart_delay: 200,
    env: {
      NODE_ENV: 'development',
      PORT: 5000,
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 5000,
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
  }],
};
