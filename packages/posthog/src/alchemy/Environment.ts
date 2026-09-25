/**
 * The `PostHog.Environment` alchemy resource (a project's tokens) and its provider.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import { Resource } from "alchemy/Resource";
import { createPostHogApi, type PostHogEnvironmentRecord } from "./Api.ts";
import { postHogResourceProvider, withMissingAsUndefined } from "./ProviderUtils.ts";
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
type EnvironmentProps = {
  projectId: string;
  environmentId: number;
  refreshProjectToken?: boolean | undefined;
  rotateSecretToken?: boolean | undefined;
};

type EnvironmentResource = Resource<
  "PostHog.Environment",
  EnvironmentProps,
  {
    projectId: string;
    environmentId: number;
    environmentName: string;
    environmentUuid: string | null;
    organization: string | null;
    apiToken: string | null;
    secretApiToken: string | null;
    secretApiTokenBackup: string | null;
    appUrls: string[];
    createdAt: string | null;
    updatedAt: string | null;
  },
  never,
  Providers
>;

/* oxlint-enable effect/prefer-option-over-null */

/**
 * A PostHog environment (project) whose tokens the stack can refresh / rotate; attributes carry the tokens for other resources to bind.
 *
 * @example
 * ```ts
 * import { Environment } from "@thomasfosterau/effect-web-posthog/alchemy"
 *
 * Environment.Type // "PostHog.Environment"
 * ```
 *
 * @since 0.1.0
 * @category resources
 */
export const Environment = Resource<EnvironmentResource>("PostHog.Environment");

const toAttributes = (environment: PostHogEnvironmentRecord) => ({
  projectId: String(environment.project_id),
  environmentId: environment.id,
  environmentName: environment.name,
  environmentUuid: environment.uuid,
  organization: environment.organization,
  apiToken: environment.api_token,
  secretApiToken: environment.secret_api_token,
  secretApiTokenBackup: environment.secret_api_token_backup,
  appUrls: (environment.app_urls ?? []).filter((value): value is string => Boolean(value)),
  createdAt: environment.created_at,
  updatedAt: environment.updated_at,
});

const refreshEnvironmentTokens = Effect.fn("refreshEnvironmentTokens")(function* (
  api: ReturnType<typeof createPostHogApi>,
  props: EnvironmentProps,
) {
  if (props.refreshProjectToken) {
    yield* api.refreshProjectToken({
      projectId: props.projectId,
      environmentId: props.environmentId,
    });
  }

  if (props.rotateSecretToken) {
    yield* api.rotateSecretToken({
      projectId: props.projectId,
      environmentId: props.environmentId,
    });
  }
});

/**
 * The provider layer for {@link Environment}; wired by `providers()`.
 *
 * @since 0.1.0
 * @category layers
 */
export const EnvironmentProvider = postHogResourceProvider({
  resource: Environment,
  stables: ["projectId", "environmentId"],
  identity: (props) => [props.projectId, props.environmentId],
  reconcile: (api) =>
    // reason: token refresh and missing-environment handling must remain in one provider reconciliation.
    // fallow-ignore-next-line complexity
    Effect.fn(function* ({ news, output }) {
      const projectId = output?.projectId ?? news.projectId;
      const environmentId = output?.environmentId ?? news.environmentId;

      yield* refreshEnvironmentTokens(api, {
        projectId,
        environmentId,
        refreshProjectToken: news.refreshProjectToken,
        rotateSecretToken: news.rotateSecretToken,
      });

      const environment = yield* withMissingAsUndefined(
        api.getEnvironment({
          projectId,
          environmentId,
        }),
      );

      if (!environment) {
        if (output) {
          return output;
        }

        return yield* Effect.die(
          new Error(`PostHog environment ${projectId}/${environmentId} not found during reconcile`),
        );
      }

      return toAttributes(environment);
    }),
  delete: () =>
    Effect.fn(function* () {
      yield* Effect.void;
    }),
  read: (api) =>
    Effect.fn(function* ({ output }) {
      if (!output) {
        return undefined;
      }

      return yield* withMissingAsUndefined(
        api
          .getEnvironment({
            projectId: output.projectId,
            environmentId: output.environmentId,
          })
          .pipe(Effect.map(toAttributes)),
      );
    }),
});
