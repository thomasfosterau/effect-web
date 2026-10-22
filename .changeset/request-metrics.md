---
"@thomasfosterau/effect-web": minor
---

Add a per-request metric scope to `./observability`. `withRequestMetrics(fn, onSettle)` runs `fn` with a fresh `Metric.Counter` and `MetricRegistry`, scoped through `AsyncLocalStorage`, and hands the settled `{ count }` to `onSettle` whether `fn` resolves or rejects. `incrementRequestMetric(amount?)` and `currentRequestMetrics()` add to the active scope and read it from plain code. `countingProxy(client, methodNames)` counts each call of a named method on a client, invoking it with the real client as `this`: a per-request query count. The entry now imports `node:async_hooks`; on Workers that needs `nodejs_compat`.
