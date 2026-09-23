/**
 * `@thomasfosterau/effect-web-posthog` — the peer-free core the `./server`
 * and `./browser` entries share: the event scrubber both `before_send` hooks
 * run, and the project-token gate. Ported from the applications'
 * `apps/web/src/lib/posthog.ts` and the `configuredToken` seam of
 * `lib/analytics.ts` / `lib/server/posthog.ts`.
 *
 * The IaC (`./alchemy`), the server client (`./server`) and the browser
 * client (`./browser`) each carry their own optional peer; nothing here
 * imports any of them.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Str from "effect/String";

/**
 * The header names scrubbed from an event's `headers` bag, lower-cased.
 *
 * @since 0.1.0
 * @category constants
 */
export const SENSITIVE_HEADERS: HashSet.HashSet<string> = HashSet.make(
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "x-api-key",
);

/**
 * The replacement a scrubbed value is set to.
 *
 * @since 0.1.0
 * @category constants
 */
export const FILTERED = "[Filtered]";

const scrubHeaders = (headers: unknown): void => {
  if (!Predicate.isObjectOrArray(headers)) return;
  // SAFETY: a structural write into an arbitrary object's string keys; only
  // keys already present and matching the allow-list are overwritten.
  const record = headers as Record<string, unknown>;
  for (const key of Arr.filter(Record.keys(record), (key) =>
    HashSet.has(SENSITIVE_HEADERS, key.toLowerCase()),
  )) {
    record[key] = FILTERED;
  }
};

/**
 * Mutates `properties` in place, removing cookies and auth headers under
 * the `headers` / `cookies` keys, should any call site ever attach them.
 * Defence-in-depth (SEC-PRIV-001): the applications never pass raw request
 * headers or cookies into PostHog event properties, so this is a backstop on
 * top of that discipline, not a load-bearing filter.
 *
 * `null` / `undefined` mirror the SDKs' own `properties` type
 * (`Record<string, unknown> | null`, and absent).
 *
 * @example
 * ```ts
 * import { scrubPostHogProperties } from "@thomasfosterau/effect-web-posthog"
 *
 * const properties = { headers: { Cookie: "session=abc", accept: "text/html" }, cookies: { a: 1 } }
 * scrubPostHogProperties(properties)
 * properties.headers.Cookie // "[Filtered]"
 * properties.headers.accept // "text/html"
 * properties.cookies // "[Filtered]"
 * ```
 *
 * @since 0.1.0
 * @category scrubbing
 */
export const scrubPostHogProperties = (
  // oxlint-disable-next-line effect/prefer-option-over-null -- vendor mirror: the argument is the `properties` bag off a posthog-js `CaptureResult` / posthog-node `EventMessage`, which the SDKs type `Record<string, unknown> | null` and may omit entirely.
  properties: Record<string, unknown> | null | undefined,
): void => {
  if (properties === null || properties === undefined) return;
  scrubHeaders(properties.headers);
  if (properties.cookies !== undefined && properties.cookies !== null) {
    properties.cookies = FILTERED;
  }
};

/**
 * The `before_send` hook shape shared by posthog-js (`CaptureResult | null`)
 * and posthog-node (`EventMessage | null`) — both carry a `properties` bag.
 * One implementation for both client and server `before_send` wiring, so a
 * scrub-logic change can never land on only one side.
 *
 * @example
 * ```ts
 * import { scrubPostHogEvent } from "@thomasfosterau/effect-web-posthog"
 *
 * const event = { properties: { headers: { authorization: "Bearer x" } } }
 * scrubPostHogEvent(event) === event // true — scrubbed in place
 * event.properties.headers.authorization // "[Filtered]"
 * scrubPostHogEvent(null) // null
 * ```
 *
 * @since 0.1.0
 * @category scrubbing
 */
// oxlint-disable-next-line effect/prefer-option-over-null -- vendor mirror: this IS the posthog-js / posthog-node `before_send` signature (`CaptureResult | null` / `EventMessage | null`, each with a nullable `properties`); returning `None` would hand the SDK a value it does not understand.
export const scrubPostHogEvent = <
  T extends { readonly properties?: Record<string, unknown> | null | undefined } | null,
>(
  event: T,
): T => {
  if (event !== null) scrubPostHogProperties(event.properties);
  return event;
};

/**
 * The configured PostHog project token, `None` when analytics is off — the
 * state a local dev run or a PR stage without the token produces. A blank
 * value is filtered defensively on top of the build-time fold: a `Some("")`
 * must never read as "configured" (the trap a truthiness guard once avoided,
 * website commit 9e7114ae).
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { resolveProjectToken } from "@thomasfosterau/effect-web-posthog"
 *
 * resolveProjectToken("phc_abc") // Option.some("phc_abc")
 * Option.isNone(resolveProjectToken("  ")) // true
 * Option.isNone(resolveProjectToken(undefined)) // true
 * ```
 *
 * @since 0.1.0
 * @category configuration
 */
export const resolveProjectToken = (value: string | undefined): Option.Option<string> =>
  Option.filter(Option.fromUndefinedOr(value), (token) => Str.isNonEmpty(token.trim()));
