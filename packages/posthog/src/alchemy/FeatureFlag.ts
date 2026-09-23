/**
 * The `PostHog.FeatureFlag` alchemy resource and its provider.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Resource } from "alchemy/Resource";
import type { FlagFilters, PostHogFeatureFlagRecord } from "./Api.ts";
import { postHogResourceProvider, withSdkMissingAsUndefined } from "./ProviderUtils.ts";
import type { Providers } from "./Providers.ts";

/*
 * The prop/attribute shapes below are NOT migrated to `Option`, and must not
 * be: alchemy PERSISTS a resource's props and attributes to the state store
 * via `JSON.stringify(encodeState(...))` (`alchemy/lib/State/StateEncoding.js`,
 * `LocalState.js`). `encodeState` has no `Option` case, so an `Option` would be
 * walked as a plain object and its `reviveState` counterpart would not rebuild
 * it — every later plan would then diff a live `Option` against a plain object
 * and churn a phantom replace forever. That is precisely the failure alchemy
 * documents for `Date`, which is why `Date` needed a marker there. `null` is
 * the persisted-state vocabulary; `Option` stops one layer up, in `Api.ts`.
 */
/* oxlint-disable effect/prefer-option-over-null -- alchemy persisted state: props/attributes are JSON-serialised into the state store by `encodeState`, which has no `Option` codec. See the note above. */
type FeatureFlagProps = {
  projectId: string;
  key: string;
  name?: string;
  active?: boolean;
  filters?: FlagFilters;
  tags?: string[];
  delete?: boolean;
};

type FeatureFlagResource = Resource<
  "PostHog.FeatureFlag",
  FeatureFlagProps,
  {
    id: number;
    key: string;
    name: string | null;
    active: boolean;
    filters: Record<string, unknown>;
    tags: unknown[];
    projectId: string;
    createdAt: string | null;
    updatedAt: string | null;
  },
  never,
  Providers
>;

type FeatureFlagOutput = {
  id: number;
  key: string;
  name: string | null;
  active: boolean;
  filters: Record<string, unknown>;
  tags: unknown[];
  projectId: string;
  createdAt: string | null;
  updatedAt: string | null;
  delete?: boolean;
};

/* oxlint-enable effect/prefer-option-over-null */

/**
 * A PostHog feature flag, keyed by `projectId` + `key` (a change replaces).
 *
 * @example
 * ```ts
 * import { FeatureFlag } from "@thomasfosterau/effect-web-posthog/alchemy"
 *
 * FeatureFlag.Type // "PostHog.FeatureFlag"
 * ```
 *
 * @since 0.1.0
 * @category resources
 */
export const FeatureFlag = Resource<FeatureFlagResource>("PostHog.FeatureFlag");

// Seam: `PostHogFeatureFlagRecord` models absence with `Option`; the alchemy
// attributes it feeds are persisted state and must stay plain `null`.
const toAttributes = (flag: PostHogFeatureFlagRecord, projectId: string) => ({
  id: flag.id,
  key: flag.key,
  name: Option.getOrNull(flag.name),
  active: flag.active,
  filters: flag.filters,
  tags: flag.tags,
  projectId,
  createdAt: Option.getOrNull(flag.created_at),
  updatedAt: Option.getOrNull(flag.updated_at),
});

/**
 * The provider layer for {@link FeatureFlag}; wired by `providers()`.
 *
 * @since 0.1.0
 * @category layers
 */
export const FeatureFlagProvider = postHogResourceProvider({
  resource: FeatureFlag,
  stables: ["projectId", "key"],
  identity: (props) => [props.projectId, props.key],
  reconcile: (api) =>
    // reason: IaC reconciliation (create-or-update against PostHog) is exercised by a deploy, not a unit test — the same posture the applications' fallow baselines record for this file.
    // fallow-ignore-next-line complexity
    Effect.fn(function* ({ news, output }) {
      if (!output) {
        const flag = yield* api.createFeatureFlag({
          projectId: news.projectId,
          key: news.key,
          ...(news.name !== undefined && { name: news.name }),
          ...(news.active !== undefined && { active: news.active }),
          ...(news.filters !== undefined && { filters: news.filters }),
          ...(news.tags !== undefined && { tags: news.tags }),
        });

        return toAttributes(flag, news.projectId);
      }

      const flag = yield* withSdkMissingAsUndefined(
        api.updateFeatureFlag({
          projectId: output.projectId,
          id: output.id,
          ...(news.name !== undefined && { name: news.name }),
          ...(news.active !== undefined && { active: news.active }),
          ...(news.filters !== undefined && { filters: news.filters }),
          ...(news.tags !== undefined && { tags: news.tags }),
        }),
      );

      return flag ? toAttributes(flag, output.projectId) : output;
    }),
  delete: (api) =>
    // SAFETY: alchemy's `delete` input carries the full plan session; the
    // handler reads only `output`, whose shape is the `*Output` type above.
    (({ output }: { output: FeatureFlagOutput }) =>
      output.delete
        ? withSdkMissingAsUndefined(
            api.deleteFeatureFlag({ projectId: output.projectId, id: output.id }),
          )
        : Effect.void) as never,
  read: (api) =>
    Effect.fn(function* ({ output }) {
      if (!output) {
        return undefined;
      }

      const flag = yield* withSdkMissingAsUndefined(
        api.getFeatureFlag({ projectId: output.projectId, id: output.id }),
      );

      return flag ? toAttributes(flag, output.projectId) : undefined;
    }),
});
