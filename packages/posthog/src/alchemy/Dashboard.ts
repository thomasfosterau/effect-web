/**
 * The `PostHog.Dashboard` alchemy resource and its provider.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Resource } from "alchemy/Resource";
import type { PostHogDashboardRecord } from "./Api.ts";
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
type DashboardProps = {
  projectId: string;
  name: string;
  description?: string;
  tags?: string[];
  pinned?: boolean;
  delete?: boolean;
};

type DashboardResource = Resource<
  "PostHog.Dashboard",
  DashboardProps,
  {
    id: number;
    name: string;
    description: string | null;
    tags: string[];
    pinned: boolean;
    projectId: string;
    createdAt: string | null;
  },
  never,
  Providers
>;

type DashboardOutput = {
  id: number;
  name: string;
  description: string | null;
  tags: string[];
  pinned: boolean;
  projectId: string;
  createdAt: string | null;
  delete?: boolean;
};

/* oxlint-enable effect/prefer-option-over-null */

/**
 * A PostHog dashboard; `delete: true` removes it on destroy, otherwise it is left in place.
 *
 * @example
 * ```ts
 * import { Dashboard } from "@thomasfosterau/effect-web-posthog/alchemy"
 *
 * Dashboard.Type // "PostHog.Dashboard"
 * ```
 *
 * @since 0.1.0
 * @category resources
 */
export const Dashboard = Resource<DashboardResource>("PostHog.Dashboard");

// Seam: `PostHogDashboardRecord` models absence with `Option`; the alchemy
// attributes it feeds are persisted state and must stay plain `null`.
const toAttributes = (dashboard: PostHogDashboardRecord, projectId: string) => ({
  id: dashboard.id,
  name: dashboard.name,
  description: Option.getOrNull(dashboard.description),
  tags: dashboard.tags,
  pinned: dashboard.pinned,
  projectId,
  createdAt: Option.getOrNull(dashboard.created_at),
});

/**
 * The provider layer for {@link Dashboard}; wired by `providers()`.
 *
 * @since 0.1.0
 * @category layers
 */
export const DashboardProvider = postHogResourceProvider({
  resource: Dashboard,
  identity: (props) => [props.projectId],
  reconcile: (api) =>
    // reason: IaC reconciliation (create-or-update against PostHog) is exercised by a deploy, not a unit test — the same posture the applications' fallow baselines record for this file.
    // fallow-ignore-next-line complexity
    Effect.fn(function* ({ news, output }) {
      if (!output) {
        const dashboard = yield* api.createDashboard({
          projectId: news.projectId,
          name: news.name,
          ...(news.description !== undefined && { description: news.description }),
          ...(news.tags !== undefined && { tags: news.tags }),
          ...(news.pinned !== undefined && { pinned: news.pinned }),
        });

        return toAttributes(dashboard!, news.projectId);
      }

      const dashboard = yield* withSdkMissingAsUndefined(
        api.updateDashboard({
          projectId: output.projectId,
          id: output.id,
          name: news.name,
          ...(news.description !== undefined && { description: news.description }),
          ...(news.tags !== undefined && { tags: news.tags }),
          ...(news.pinned !== undefined && { pinned: news.pinned }),
        }),
      );

      return dashboard ? toAttributes(dashboard, output.projectId) : output;
    }),
  delete: (api) =>
    // SAFETY: alchemy's `delete` input carries the full plan session; the
    // handler reads only `output`, whose shape is the `*Output` type above.
    (({ output }: { output: DashboardOutput }) =>
      output.delete
        ? withSdkMissingAsUndefined(
            api.deleteDashboard({ projectId: output.projectId, id: output.id }),
          )
        : Effect.void) as never,
  read: (api) =>
    Effect.fn(function* ({ output }) {
      if (!output) {
        return undefined;
      }

      const dashboard = yield* withSdkMissingAsUndefined(
        api.getDashboard({ projectId: output.projectId, id: output.id }),
      );

      return dashboard ? toAttributes(dashboard, output.projectId) : undefined;
    }),
});
