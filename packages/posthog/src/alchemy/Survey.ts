/**
 * The `PostHog.Survey` alchemy resource and its provider.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Resource } from "alchemy/Resource";
import type { PostHogSurveyRecord } from "./Api.ts";
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
type SurveyType = "popover" | "widget" | "external_survey" | "api";

type SurveyProps = {
  projectId: string;
  name: string;
  description?: string;
  type?: SurveyType;
  delete?: boolean;
};

type SurveyResource = Resource<
  "PostHog.Survey",
  SurveyProps,
  {
    id: string;
    name: string | null;
    description: string | null;
    type: string | null;
    projectId: string;
    startDate: string | null;
    endDate: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  },
  never,
  Providers
>;

type SurveyOutput = {
  id: string;
  name: string | null;
  description: string | null;
  type: string | null;
  projectId: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  delete?: boolean;
};

/* oxlint-enable effect/prefer-option-over-null */

/**
 * A PostHog survey; `delete: true` removes it on destroy.
 *
 * @example
 * ```ts
 * import { Survey } from "@thomasfosterau/effect-web-posthog/alchemy"
 *
 * Survey.Type // "PostHog.Survey"
 * ```
 *
 * @since 0.1.0
 * @category resources
 */
export const Survey = Resource<SurveyResource>("PostHog.Survey");

// Seam: `PostHogSurveyRecord` models absence with `Option`; the alchemy
// attributes it feeds are persisted state and must stay plain `null`.
const toAttributes = (survey: PostHogSurveyRecord, projectId: string) => ({
  id: survey.id,
  name: Option.getOrNull(survey.name),
  description: Option.getOrNull(survey.description),
  type: Option.getOrNull(survey.type),
  projectId,
  startDate: Option.getOrNull(survey.start_date),
  endDate: Option.getOrNull(survey.end_date),
  createdAt: Option.getOrNull(survey.created_at),
  updatedAt: Option.getOrNull(survey.updated_at),
});

/**
 * The provider layer for {@link Survey}; wired by `providers()`.
 *
 * @since 0.1.0
 * @category layers
 */
export const SurveyProvider = postHogResourceProvider({
  resource: Survey,
  identity: (props) => [props.projectId],
  reconcile: (api) =>
    // reason: IaC reconciliation (create-or-update against PostHog) is exercised by a deploy, not a unit test — the same posture the applications' fallow baselines record for this file.
    // fallow-ignore-next-line complexity
    Effect.fn(function* ({ news, output }) {
      if (!output) {
        const survey = yield* api.createSurvey({
          projectId: news.projectId,
          name: news.name,
          ...(news.description !== undefined && { description: news.description }),
          ...(news.type !== undefined && { type: news.type }),
        });

        return toAttributes(survey, news.projectId);
      }

      const survey = yield* withSdkMissingAsUndefined(
        api.updateSurvey({
          projectId: output.projectId,
          id: output.id,
          name: news.name,
          ...(news.description !== undefined && { description: news.description }),
          ...(news.type !== undefined && { type: news.type }),
        }),
      );

      return survey ? toAttributes(survey, output.projectId) : output;
    }),
  delete: (api) =>
    // SAFETY: alchemy's `delete` input carries the full plan session; the
    // handler reads only `output`, whose shape is the `*Output` type above.
    (({ output }: { output: SurveyOutput }) =>
      output.delete
        ? withSdkMissingAsUndefined(
            api.deleteSurvey({ projectId: output.projectId, id: output.id }),
          )
        : Effect.void) as never,
  read: (api) =>
    Effect.fn(function* ({ output }) {
      if (!output) {
        return undefined;
      }

      const survey = yield* withSdkMissingAsUndefined(
        api.getSurvey({ projectId: output.projectId, id: output.id }),
      );

      return survey ? toAttributes(survey, output.projectId) : undefined;
    }),
});
