# Production Node API

Production-ready Node.js API with PM2 process management, Prometheus monitoring, CI/CD pipeline, Nginx load balancing, and security hardening.

## Tech Stack

- **Express.js** — REST API server
- **PM2** — Process manager with cluster mode (multi-core)
- **Prometheus + prom-client** — Metrics & monitoring
- **Winston** — Structured logging
- **Helmet** — Security headers
- **express-rate-limit** — DDoS/abuse protection
- **GitHub Actions** — CI/CD pipeline
- **Nginx** — Reverse proxy & load balancing

## Project Structure

```
server.js               # Express server with Prometheus metrics & security
ecosystem.config.js     # PM2 cluster config (auto-restart, max CPU cores)
package.json
.github/
└── workflows/
    └── ci-cd.yml       # GitHub Actions: test → audit → deploy
monitoring/
├── prometheus.yml      # Prometheus scrape config
└── alerts.yml          # Alerting rules
nginx/
└── nginx.conf          # Reverse proxy config
frontend-test/          # Next.js test dashboard (port 3102)
```

## Getting Started

```bash
npm install

# Development
npm run dev

# Production with PM2 (cluster mode)
npm run start
```

Server runs at **http://localhost:5000**

## API Endpoints

| Method | Endpoint      | Description                        |
| ------ | ------------- | ---------------------------------- |
| `GET`  | `/`           | API info                           |
| `GET`  | `/api/health` | Health check (uptime, status)      |
| `GET`  | `/metrics`    | Prometheus metrics scrape endpoint |

## PM2 Commands

```bash
npm run pm2:start    # Start in cluster mode
npm run pm2:stop     # Stop all processes
npm run pm2:restart  # Restart all processes
npm run pm2:logs     # Stream logs
npm run pm2:monit    # Real-time process monitor
```

## Monitoring

### Prometheus

Scrapes `/metrics` endpoint. Config in `monitoring/prometheus.yml`.

```bash
# Run Prometheus locally
docker run -p 9090:9090 -v $(pwd)/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml prom/prometheus
```

### Metrics Tracked

- `http_requests_total` — Request count by method/route/status
- `http_request_duration_seconds` — Latency histogram
- Default Node.js metrics (heap, event loop, GC)

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci-cd.yml`):

1. Runs tests on Node 18.x and 20.x
2. Security audit (`npm audit`)
3. Uploads coverage report

## Environment Variables

```env
PORT=5000
NODE_ENV=production
LOG_LEVEL=info
```

## Production Features

| Feature            | Implementation                   |
| ------------------ | -------------------------------- |
| Process management | PM2 cluster mode (all CPU cores) |
| Auto-restart       | On crash, memory > 500MB         |
| Security headers   | Helmet middleware                |
| Rate limiting      | 100 req/15min per IP             |
| Structured logging | Winston (file + console)         |
| Metrics            | Prometheus `/metrics` endpoint   |
| Load balancing     | Nginx reverse proxy              |
| CI/CD              | GitHub Actions                   |

---

## 📝 License

Proprietary - All rights reserved.
