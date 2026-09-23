/**
 * The `Providers` collection tag and the `providers()` thunk an `alchemy.run.ts` merges.
 *
 * @since 0.1.0
 */
import * as Layer from "effect/Layer";
import * as Provider from "alchemy/Provider";
import { fromEnvironment } from "./Config.ts";
import { Environment, EnvironmentProvider } from "./Environment.ts";
import { Dashboard, DashboardProvider } from "./Dashboard.ts";
import { FeatureFlag, FeatureFlagProvider } from "./FeatureFlag.ts";
import { asClassLike } from "./ProviderUtils.ts";
import { Survey, SurveyProvider } from "./Survey.ts";

/**
 * The `ProviderCollection` tag every PostHog resource declares as its
 * provider requirement.
 *
 * @since 0.1.0
 * @category services
 */
export class Providers extends Provider.ProviderCollection<Providers>()("PostHog") {}

// The `() =>` thunk is deliberate and stays, despite the language service's
// `lazyEffect` suggestion: every alchemy provider package exports
// `providers` with exactly this shape (`Cloudflare`, `Planetscale`,
// `Drizzle`, `GitHub`, `Command`, …), and `alchemy.run.ts` calls all six
// side by side. Dropping the thunk here would make PostHog the one entry in
// that list that is not invoked.
/**
 * The PostHog provider collection, as a thunk with the same shape every
 * alchemy provider package exports (`Cloudflare.providers()`, …), so an
 * `alchemy.run.ts` merges it side by side with them:
 * `Layer.mergeAll(Cloudflare.providers(), PostHog.providers(), …)`. **Every
 * alchemy resource module's `providers()` must be merged there** — a missing
 * one fails *intermittently* at deploy with "Provider not found".
 *
 * Reads `POSTHOG_HOST` / `POSTHOG_API_KEY` through {@link fromEnvironment}.
 *
 * @example
 * ```ts
 * import { providers } from "@thomasfosterau/effect-web-posthog/alchemy"
 *
 * typeof providers() // "object" — a Layer, merged into the stack's providers
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const providers = () =>
  Layer.effect(
    Providers,
    Provider.collection([
      asClassLike(Environment),
      asClassLike(Dashboard),
      asClassLike(FeatureFlag),
      asClassLike(Survey),
    ]),
  ).pipe(
    Layer.provide(EnvironmentProvider),
    Layer.provide(DashboardProvider),
    Layer.provide(FeatureFlagProvider),
    Layer.provide(SurveyProvider),
    Layer.provideMerge(fromEnvironment),
    Layer.orDie,
  );
