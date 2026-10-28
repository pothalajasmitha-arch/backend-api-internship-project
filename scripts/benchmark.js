const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

function positiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) return fallback;
  return parsed;
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return 0;
  return sortedValues[Math.min(Math.ceil(sortedValues.length * fraction) - 1, sortedValues.length - 1)];
}

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const durationSeconds = positiveInteger(process.env.DURATION_SECONDS, 30, 600);
  const concurrency = positiveInteger(process.env.CONCURRENCY, 10, 100);
  const limit = positiveInteger(process.env.PAGE_LIMIT, 20, 100);
  const deadline = performance.now() + durationSeconds * 1000;
  const latenciesMs = [];
  let errors = 0;
  let requests = 0;

  const worker = async () => {
    while (performance.now() < deadline) {
      const started = performance.now();
      try {
        const response = await fetch(`${baseUrl}/api/posts?limit=${limit}&offset=0`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) errors += 1;
        await response.arrayBuffer();
      } catch {
        errors += 1;
      }
      latenciesMs.push(performance.now() - started);
      requests += 1;
    }
  };

  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedSeconds = (performance.now() - started) / 1000;
  latenciesMs.sort((left, right) => left - right);
  const result = {
    target: `${baseUrl}/api/posts?limit=${limit}&offset=0`,
    concurrency,
    durationSeconds: Number(elapsedSeconds.toFixed(2)),
    requests,
    errors,
    requestsPerSecond: Number((requests / elapsedSeconds).toFixed(2)),
    latencyMs: {
      p50: Number(percentile(latenciesMs, 0.5).toFixed(2)),
      p95: Number(percentile(latenciesMs, 0.95).toFixed(2)),
      p99: Number(percentile(latenciesMs, 0.99).toFixed(2)),
      max: Number((latenciesMs.at(-1) || 0).toFixed(2)),
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (process.env.RESULT_FILE) {
    fs.writeFileSync(process.env.RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});