/**
 * Type-level tests for the Service Worker entry: the expect-error directives
 * are the assertions, checked by tsconfig.test.json. Every binding is
 * exported so an unused-local error can never stand in for the assertion a
 * directive expects.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { FetchFailed } from "@thomasfosterau/effect-web/net";
import {
  type CacheError,
  type CacheMiss,
  cacheFirst,
  cacheOnly,
  type ExtendableMessageEventLike,
  type FetchEventLike,
  fetchListener,
  messageListener,
  networkOnly,
  type PrecacheRejected,
  precache,
  route,
} from "@thomasfosterau/effect-web/service-worker";

type Assert<T extends true> = T;
type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;

// Strategies name their failures and need no service: both globals they
// touch are references with defaults.
export const answered = cacheFirst({ cacheName: "assets" })(new Request("https://example.com/"));
export const missed = cacheOnly({ cacheName: "shell" })(new Request("https://example.com/"));
export const installed = precache("shell", ["https://example.com/"]);

// `cacheOnly` writes nothing, so it takes no `cacheable`.
// @ts-expect-error -- `cacheable` is not an option of cacheOnly
export const writingCacheOnly = cacheOnly({ cacheName: "shell", cacheable: () => true });

// A route's match is decided during dispatch: it cannot be an effect.
// @ts-expect-error -- `match` must return a boolean synchronously
export const asyncMatch = route(() => Effect.succeed(true), networkOnly);

// A route table's services are the union of its routes' services.
export class Offline extends Context.Service<Offline, { readonly page: Response }>()(
  "tests/Offline",
) {}
export const listener = fetchListener([
  route(() => true, networkOnly),
  route(
    () => true,
    () => Offline.useSync((offline) => offline.page),
  ),
]);

// A message handler gets the decoded type, never `unknown`.
const Ping = Schema.Struct({ id: Schema.Number });
export const onMessage = messageListener(Ping, (message: { readonly id: number }) =>
  Effect.succeed(message.id),
);

export type Checks = [
  /** _cacheFirstErrors */ Assert<Equals<Effect.Error<typeof answered>, CacheError | FetchFailed>>,
  /** _cacheFirstNeedsNoService */ Assert<Equals<Effect.Services<typeof answered>, never>>,
  /** _cacheOnlyErrors */ Assert<Equals<Effect.Error<typeof missed>, CacheError | CacheMiss>>,
  /** _precacheErrors */ Assert<
    Equals<Effect.Error<typeof installed>, CacheError | FetchFailed | PrecacheRejected>
  >,
  /** _routeServicesUnion */ Assert<Equals<Effect.Services<typeof listener>, Offline>>,
  /** _listenerTakesFetchEvent */ Assert<
    Equals<Effect.Success<typeof listener>, (event: FetchEventLike) => void>
  >,
  /** _messageListenerTakesMessageEvent */ Assert<
    Equals<Effect.Success<typeof onMessage>, (event: ExtendableMessageEventLike) => void>
  >,
];
