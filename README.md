# Raaho.com — L2 DevOps Practical Assignment

A fully containerized, locally runnable demo environment showing Docker, Docker
Compose, Nginx reverse proxying, Docker networking, centralized logging
(ELK), and monitoring (Prometheus + Grafana).

---

## 1. Architecture / Topology

```
                        Client / Browser
                              |
                              v
                          Nginx (:80)
                              |
                              v
                   Sample Node.js/Express App (:5000)
                       /                  \
                      /                    \
           Container logs (stdout)     /metrics endpoint
             via Docker GELF               |
                      |                    v
                      v               Prometheus (:9090)
               Logstash (:12201/udp)       |
                      |                    v
                      v                Grafana (:3000)
              Elasticsearch (:9200)
                      |
                      v
                  Kibana (:5601)
```

**Components**

| Component      | Role                                                                 |
|----------------|-----------------------------------------------------------------------|
| Sample App     | A small Node.js/Express app (`/`, `/work`, `/error`, `/health`, `/metrics`) |
| Nginx          | Reverse proxy in front of the app                                     |
| Logstash       | Receives container logs (GELF/UDP), parses JSON, forwards to ES       |
| Elasticsearch  | Stores/indexes logs                                                   |
| Kibana         | UI to search/visualize logs stored in Elasticsearch                   |
| Prometheus     | Scrapes `/metrics` from the app on a timer                            |
| Grafana        | Dashboard on top of Prometheus (auto-provisioned)                     |

All services run on one Docker user-defined bridge network, **`devops-net`**,
so they resolve each other by service name (e.g. `http://app:5000`,
`http://elasticsearch:9200`).

> **Networking note on logging:** Docker's built-in logging drivers (like
> `gelf`) execute inside the Docker **daemon's** process/network namespace,
> not inside the compose-defined bridge network. Because of that, the
> `app` and `nginx` containers ship logs to Logstash via the **host-published**
> UDP port (`127.0.0.1:12201`) rather than via the `logstash` service name.
> Everything else (app <-> Prometheus, Logstash <-> Elasticsearch, Kibana <->
> Elasticsearch, Grafana <-> Prometheus) talks over the internal Docker
> network by service name.

---

## 2. Prerequisites

* Docker Engine 24+ and Docker Compose v2 (`docker compose version`)
* ~4 GB of free RAM available to Docker (Elasticsearch + Kibana + Logstash
  are the heaviest pieces)
* Linux/macOS/WSL2. On Linux hosts you may need to raise a kernel setting
  for Elasticsearch (see Troubleshooting §7.1)
* Ports `80, 3000, 5000, 5601, 9090, 9200, 9600, 12201` free on your machine
* Node.js is **not** required on the host — the app runs entirely inside its
  container. Only Docker + Docker Compose need to be installed locally.

### Installing Docker on Ubuntu (if not already installed)

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Run docker without sudo (log out/in, or `newgrp docker`, after this)
sudo usermod -aG docker $USER

# Verify
docker --version
docker compose version
```

---

## 3. Setup & Execution

```bash
git clone <this-repo-url>
cd raaho-devops-assignment

# Build and start everything in the background
docker compose up -d --build

# Watch startup logs (Elasticsearch/Kibana take the longest, ~30-60s)
docker compose logs -f
```

To stop everything:

```bash
docker compose down
```

To stop and wipe persisted data (Elasticsearch index + Grafana settings):

```bash
docker compose down -v
```

---

## 4. Ports Reference

| Service        | Host Port | Purpose                                   |
|----------------|-----------|--------------------------------------------|
| Nginx          | 80        | Main entry point for the application        |
| Sample App     | 5000      | Direct app access (bypasses Nginx; debugging) |
| Elasticsearch  | 9200      | REST API / index inspection                  |
| Kibana         | 5601      | Log search & visualization UI                |
| Logstash       | 12201/udp | GELF input — receives container logs         |
| Logstash       | 9600      | Logstash monitoring API                      |
| Prometheus     | 9090      | Metrics UI / query / target status           |
| Grafana        | 3000      | Dashboards (login: `admin` / `admin`)        |

---

## 5. Log Flow Explained

1. The Node.js/Express app logs structured JSON lines to **stdout** (via
   `pino`) for every request and error.
2. Both the `app` and `nginx` containers are configured with the **`gelf`**
   Docker logging driver, which streams every log line as a GELF UDP packet
   to `127.0.0.1:12201` (Logstash's published port) as soon as it's written
   — no extra log-shipping agent (Filebeat, etc.) is needed.
3. **Logstash** listens on `12201/udp` with the `gelf` input plugin. Its
   filter tries to parse the `message` field as JSON (so app fields like
   `endpoint`, `duration_seconds`, log `level`, etc. become individual,
   searchable fields) and tags the environment.
4. Logstash outputs each event into **Elasticsearch** under a daily index:
   `app-logs-YYYY.MM.dd`.
5. **Kibana** reads from Elasticsearch. Create an index pattern once
   (`app-logs-*`) and you can search/filter/visualize all app + nginx logs.

---

## 6. Metrics Flow Explained

1. The Node.js/Express app uses `prom-client`, which exposes a `/metrics`
   endpoint with default process metrics (`process_cpu_seconds_total`,
   `process_resident_memory_bytes`, etc.) plus two custom metrics:
   `http_requests_total` (counter, labeled by method/route/status_code) and
   `http_request_duration_seconds` (histogram, labeled by method/route).
2. **Prometheus** is configured (`prometheus/prometheus.yml`) to scrape
   `app:5000/metrics` every 10 seconds, over the internal Docker network.
3. **Grafana** is pre-provisioned (no manual clicking needed) with:
   - a **Prometheus datasource** pointing at `http://prometheus:9090`
   - a **dashboard** ("Sample App - Overview") with panels for request
     rate, p95 latency, process memory, target up/down, and 5xx count.

---

## 7. Verification Checklist

| # | Check                                                                 | How |
|---|-------------------------------------------------------------------------|-----|
| 1 | App reachable through Nginx | `curl http://localhost/` -> JSON greeting |
| 2 | Nginx forwards correctly | `curl http://localhost/health` -> `{"status": "healthy"}` |
| 3 | Containers on shared network | `docker network inspect raaho-devops-assignment_devops-net` shows all containers |
| 4 | Logs reaching ELK | Generate traffic: `curl http://localhost/work` a few times, then check `curl http://localhost:9200/app-logs-*/_count` — count should increase |
| 5 | Logs visible in Kibana | Open `http://localhost:5601` → Stack Management → Data Views → create `app-logs-*` → Discover tab shows entries |
| 6 | Metrics in Prometheus | Open `http://localhost:9090/targets` — `sample-app` target should show **State: UP** |
| 7 | Grafana dashboard | Open `http://localhost:3000` (admin/admin) → Dashboards → "Sample App - Overview" shows live panels |
| 8 | Full recreate works | `docker compose down -v && docker compose up -d --build` brings everything back cleanly |

Generate some sample traffic before checking logs/metrics:

```bash
for i in {1..20}; do curl -s http://localhost/ > /dev/null; curl -s http://localhost/work > /dev/null; done
curl -s http://localhost/error   # generates an error log + 5xx metric on purpose
```

---

## 8. Troubleshooting

### 7.1 Elasticsearch exits immediately / `max virtual memory areas` error
Linux hosts often need:
```bash
sudo sysctl -w vm.max_map_count=262144
```
(Not usually needed on Docker Desktop for macOS/Windows.)

### 7.2 Kibana shows "Kibana server is not ready yet"
Elasticsearch is still initializing. Wait ~30-60s and check:
```bash
docker compose logs elasticsearch --tail=50
curl http://localhost:9200/_cluster/health
```

### 7.3 No logs appearing in Kibana / Elasticsearch
- Confirm the GELF driver is actually configured: `docker inspect sample-app | grep -A5 LogConfig`
- Confirm Logstash is listening: `docker compose logs logstash | grep -i "gelf"`
- Send a manual test event and watch Logstash's stdout: `docker compose logs -f logstash` while curling the app.
- Make sure nothing else on the host is bound to UDP `12201`.

### 7.4 Prometheus target shows "DOWN"
- Check the app is actually up: `curl http://localhost:5000/metrics`
- Check Prometheus can resolve `app` on the internal network: `docker compose exec prometheus wget -qO- http://app:5000/metrics`
- Confirm both containers are on `devops-net`: `docker compose ps`

### 7.5 Grafana dashboard panels show "No data"
- Confirm the Prometheus datasource test succeeds: Grafana → Connections → Data sources → Prometheus → **Save & Test**
- Generate traffic first (see §7 verification) — an idle app has nothing to graph.

### 7.6 Port already in use
Edit the `ports:` mapping for the conflicting service in `docker-compose.yml`
(left side is the host port, e.g. change `"9090:9090"` to `"9091:9090"`).

### 7.7 "Cannot connect to the Docker daemon"
Make sure Docker Desktop / the Docker service is running: `docker info`.

### 7.8 A container is `Up` but shows `unhealthy`
This does **not** necessarily mean the service is broken — check the actual
logs first (`docker compose logs <service>`); the pipeline may be working
fine while just the `HEALTHCHECK` command itself fails. Common cause: the
official image doesn't include `curl`/`wget` (Logstash's image is a frequent
offender). To see exactly why a check is failing:
```bash
docker inspect --format='{{json .State.Health}}' <container_name> | python3 -m json.tool
```
This repo's healthchecks already avoid `curl` on images that don't ship it
(Logstash uses a bash `/dev/tcp` probe, Nginx uses `nc`, the app uses Node's
own `http` module) — if you still see `unhealthy`, the inspect output above
will show the exact error.

---

## 9. Design Notes / Bonus Items Included

- **Health checks & restart policies** on every service (`restart:
  unless-stopped` + `healthcheck:` blocks), so a crashed container is
  restarted and `docker compose ps` clearly shows unhealthy services.
- **Non-root container user** for the app image (the built-in `node` user
  in the official Node.js image), reducing blast radius if the app is
  compromised.
- **Resource limits** (`mem_limit`/`cpus`) on every service to avoid one
  container starving the host.
- **Pinned image versions** everywhere (no `:latest`) for reproducible
  builds.
- **Basic CI pipeline** (`.github/workflows/ci.yml`) that validates the
  compose file, builds the app image, and lints the Dockerfile with
  Hadolint on every push/PR.
- **Rollback approach:** since every image is version-pinned and the app
  image is built from source, rolling back is `git checkout <previous
  commit> && docker compose up -d --build` — Compose will recreate only the
  containers whose config/image actually changed.

---

## 10. Repository Layout

```
.
├── app/                      # Sample Node.js/Express application
│   ├── app.js
│   ├── package.json
│   ├── package-lock.json
│   └── Dockerfile
├── nginx/
│   └── nginx.conf
├── logstash/
│   ├── logstash.yml
│   └── pipeline/logstash.conf
├── prometheus/
│   └── prometheus.yml
├── grafana/
│   ├── provisioning/datasources/datasource.yml
│   ├── provisioning/dashboards/dashboard.yml
│   └── dashboards/app-dashboard.json
├── .github/workflows/ci.yml
├── docker-compose.yml
└── README.md
```
# raaho-devops-assignment
