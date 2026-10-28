# Performance Testing Procedure

This procedure records actual measurements without assuming a baseline. Use a disposable local database or staging instance, keep the same dataset and machine for comparisons, and avoid sending benchmark traffic to systems you do not own or have permission to test.

## Run

1. Install dependencies and start the API.
2. Seed a representative number of posts and authors through the API or a separate fixture.
3. Run a low-load smoke measurement, then increase concurrency gradually.
4. Save each run to a distinct JSON results file.

PowerShell examples:

```powershell
$env:CONCURRENCY = '10'
$env:DURATION_SECONDS = '30'
$env:PAGE_LIMIT = '20'
$env:RESULT_FILE = 'benchmark-results-baseline.json'
npm run benchmark
```

The script targets `http://localhost:3000/api/posts` by default. Set `BASE_URL` to a permitted test instance. Concurrency is capped at 100 and duration at 600 seconds. The output includes completed requests, errors, requests per second, and p50/p95/p99/max response latency.

## Comparison record

| Version | Dataset | Concurrency | Duration | Requests/s | p50 ms | p95 ms | p99 ms | Errors | Notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline | Fill after running | | | | | | | | |
| Optimized | Fill after running | | | | | | | | |

## Analysis and optimization candidates

The API list query joins posts to users and orders by creation time and ID. SQLite indexes cover the ordering columns and author lookups. Confirm the query plan using `EXPLAIN QUERY PLAN` on the same database before adding indexes. Candidate changes include cursor pagination for large offsets, removing or separately caching the exact `COUNT(*)` if product requirements allow approximate totals, adding a composite index justified by measured query plans, and application caching only with an explicit invalidation/freshness policy.

After each change, rerun the same data fixture and request profile. Record hardware, Node version, database size, warm-up method, and all results. A lower mean alone is insufficient; compare tail latency and errors too. Do not claim improvement unless repeated runs support it.