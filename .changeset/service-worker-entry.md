---
"@thomasfosterau/effect-web": minor
---

Add the `./service-worker` entry: Cache Storage as typed effects (`openCache`, `deleteCachesExcept`, `CacheError`), the five caching strategies (`cacheFirst`, `networkFirst` with an optional timeout, `staleWhileRevalidate`, `cacheOnly`, `networkOnly`) with the `isCacheable` write-back filter, `precache`, and listeners for `fetch` (a synchronous route table), `install` / `activate` and `message` (Schema-decoded) whose work runs inside `respondWith` / `waitUntil`. `caches` and `fetch` are context references with global defaults (`Caches`, `FetchHttpClient.Fetch`); `memoryCacheStorage` is an in-memory `CacheStorage` for tests.
