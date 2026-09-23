/**
 * The `PostHogConfig` settings service and its environment layer.
 *
 * @since 0.1.0
 */
import { DEFAULT_API_BASE_URL } from "@distilled.cloud/posthog";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

/**
 * The resolved PostHog management-API settings.
 *
 * @since 0.1.0
 * @category models
 */
export interface PostHogSettings {
  readonly baseUrl: string;
  /** `Option.none()` when `POSTHOG_API_KEY` is unset or empty. */
  readonly apiKey: Option.Option<string>;
}

/**
 * The settings service every PostHog resource provider reads.
 *
 * @since 0.1.0
 * @category services
 */
export class PostHogConfig extends Context.Service<PostHogConfig, PostHogSettings>()(
  "PostHog.Config",
) {}

const configString = (key: string, fallback = "") =>
  Config.String(key).pipe(Config.withDefault(fallback));

/**
 * `PostHogConfig` from `POSTHOG_HOST` (defaulting to the SDK's base URL) and
 * `POSTHOG_API_KEY` (a personal API key; absent or blank reads as `None`, and
 * every provider then fails with `PostHogApiNotConfiguredError` on use).
 *
 * A bare Layer, not a `() =>` thunk: Layer is already lazy, and this matches
 * alchemy's own `fromEnvironment` layers. `providers` keeps its thunk for
 * the opposite reason — see the note there.
 *
 * @example
 * ```ts
 * import * as ConfigProvider from "effect/ConfigProvider"
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { fromEnvironment, PostHogConfig } from "@thomasfosterau/effect-web-posthog/alchemy"
 *
 * const settings = await Effect.runPromise(
 *   PostHogConfig.pipe(
 *     Effect.provide(fromEnvironment),
 *     Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ POSTHOG_HOST: "https://eu.posthog.com" }))),
 *   ),
 * )
 * settings.baseUrl // "https://eu.posthog.com"
 * Option.isNone(settings.apiKey) // true
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const fromEnvironment: Layer.Layer<PostHogConfig, Config.ConfigError> = Layer.effect(
  PostHogConfig,
  Effect.gen(function* () {
    const baseUrl = yield* configString("POSTHOG_HOST", DEFAULT_API_BASE_URL);
    const apiKey = yield* configString("POSTHOG_API_KEY");

    return {
      baseUrl,
      // `configString` defaults to `""`, so an unset key arrives as the empty
      // string rather than absent — same collapse the old `apiKey || undefined`
      // performed, now expressed as absence.
      apiKey: apiKey === "" ? Option.none() : Option.some(apiKey),
    } satisfies PostHogSettings;
  }),
);
