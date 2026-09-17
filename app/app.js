const express = require("express");
const pino = require("pino");
const client = require("prom-client");

const app = express();
const PORT = 5000;

// ---------------------------------------------------------------------------
// Structured (JSON) logging -> stdout
// Docker's GELF logging driver ships stdout/stderr to Logstash, which in
// turn indexes it into Elasticsearch. pino logs single-line JSON by default,
// which is exactly what we want for easy parsing/searching in Kibana.
// ---------------------------------------------------------------------------
const logger = pino({ name: "sample-app" });

// ---------------------------------------------------------------------------
// Prometheus metrics
// ---------------------------------------------------------------------------
const register = new client.Registry();
client.collectDefaultMetrics({ register }); // process_cpu_seconds_total, process_resident_memory_bytes, etc.

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

// Middleware: time every request and record metrics once it finishes
app.use((req, res, next) => {
  const endTimer = httpRequestDuration.startTimer({ method: req.method, route: req.path });
  res.on("finish", () => {
    endTimer();
    httpRequestsTotal.inc({ method: req.method, route: req.path, status_code: res.statusCode });
  });
  next();
});

app.get("/", (req, res) => {
  logger.info({ endpoint: "/", client_ip: req.ip }, "Home endpoint hit");
  res.json({ message: "Hello from the Raaho DevOps sample app!", status: "ok" });
});

app.get("/health", (req, res) => {
  // Used by Docker HEALTHCHECK and can be probed by monitoring tools.
  res.status(200).json({ status: "healthy" });
});

app.get("/work", async (req, res) => {
  // Simulates variable-latency work so Grafana panels show something
  // interesting (latency histogram / request rate).
  const delaySeconds = +(Math.random() * (0.6 - 0.05) + 0.05).toFixed(3);
  await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  logger.info({ endpoint: "/work", duration_seconds: delaySeconds }, "Processed simulated work");
  res.json({ message: "work done", duration_seconds: delaySeconds });
});

app.get("/error", (req, res) => {
  // Intentionally returns 500 to generate error logs/metrics for testing
  // the logging & monitoring pipeline end-to-end.
  logger.error({ endpoint: "/error" }, "Simulated error endpoint triggered");
  res.status(500).json({ error: "Something went wrong (this is intentional)" });
});

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT }, "Sample app listening");
});
