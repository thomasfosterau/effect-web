/**
 * `@thomasfosterau/effect-web-posthog/alchemy` — the Alchemy v2 provider
 * and resources for a PostHog project (`Environment`, `Dashboard`,
 * `FeatureFlag`, `Survey`), the management-API client they share, and the
 * `providers()` collection an `alchemy.run.ts` merges. Ported verbatim from
 * the applications' `packages/infra-posthog/src/` (byte-identical across
 * website, gardeneria and preferenceflow).
 *
 * Deploy-time only: nothing here runs on a request, and nothing here is
 * imported by `./server` or `./browser`.
 *
 * @since 0.1.0
 */
export * from "./Api.ts";
export * from "./Config.ts";
export * from "./Dashboard.ts";
export * from "./Environment.ts";
export * from "./FeatureFlag.ts";
export * from "./ProviderUtils.ts";
export * from "./Providers.ts";
export * from "./Survey.ts";
