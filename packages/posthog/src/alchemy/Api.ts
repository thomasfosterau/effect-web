/**
 * The PostHog management-API client the resource providers share: hand-written REST for environments and SDK-derived CRUD for dashboards, feature flags and surveys, with the record types and tagged errors.
 *
 * @since 0.1.0
 */
import * as PostHogSdk from "@distilled.cloud/posthog";
import * as Dashboards from "@distilled.cloud/posthog/dashboards";
import * as Environments from "@distilled.cloud/posthog/environments";
import * as FeatureFlags from "@distilled.cloud/posthog/feature_flags";
import * as Surveys from "@distilled.cloud/posthog/surveys";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { PostHogSettings } from "./Config.ts";

/**
 * Hand-written, not SDK-derived: the vendored SDK's `Environments` operations
 * module (`@distilled.cloud/posthog/environments`) covers only side-actions
 * (token reset/rotate, onboarding flags, …) — there is no basic
 * retrieve/create/list operation for an environment to derive this from. The
 * REST call in {@link createPostHogApi.getEnvironment} is the only source.
 *
 * NOT migrated to `Option` (and fenced below): this interface is the type
 * argument to `request<T>`, whose body is `JSON.parse(text) as T`. The runtime
 * value is therefore literally the parsed PostHog JSON payload — declaring its
 * fields as `Option` would be a lie about the data, not a modelling choice.
 * Its fields also flow straight into the `PostHog.Environment` alchemy
 * attributes, which are persisted state (see the fence in `Environment.ts`).
 */
/* oxlint-disable effect/prefer-option-over-null -- external wire payload: this shape describes bytes off PostHog's REST API, materialised by `JSON.parse ... as T`. `null` here is the transported value, not modelled absence. */
/**
 * The environment payload off PostHog's REST API, as parsed.
 *
 * @since 0.1.0
 * @category models
 */
export interface PostHogEnvironmentRecord {
  id: number;
  project_id: number | string;
  uuid: string | null;
  name: string;
  organization: string | null;
  api_token: string | null;
  secret_api_token: string | null;
  secret_api_token_backup: string | null;
  app_urls: Array<string | null> | null;
  created_at: string | null;
  updated_at: string | null;
}
/* oxlint-enable effect/prefer-option-over-null */

/**
 * SDK-derived, like {@link PostHogFeatureFlagRecord} / {@link
 * PostHogSurveyRecord} below: sourced from `Dashboards.getDashboard` /
 * `createDashboard` / `updateDashboardsPartial` / `dashboardsDestroy`
 * (`@distilled.cloud/posthog/dashboards`). `@distilled.cloud/posthog@1.0.0-rc.9`
 * renamed the basic CRUD operations from the `dashboardsRetrieve` /
 * `dashboardsCreate` / `dashboardsPartialUpdate` (and `featureFlags*` /
 * `surveys*`) the applications call under rc.8 — the `*Destroy` names are the
 * one form both versions share. Narrowed with the same
 * `requireField`/`Option.fromNullishOr` pattern as the SDK output schemas mark
 * every field optional.
 *
 * @since 0.1.0
 * @category models
 */
export interface PostHogDashboardRecord {
  id: number;
  name: string;
  description: Option.Option<string>;
  tags: string[];
  pinned: boolean;
  created_at: Option.Option<string>;
}

/**
 * The feature-flag `filters` payload forwarded to PostHog. Sourced from the
 * SDK's create-input type (structurally identical to the partial-update input's)
 * so it stays exactly assignable to both operations: the SDK now types each
 * group's `properties` conditions as a precise union rather than an opaque
 * array, which a hand-written looser shape (`unknown[]`) no longer satisfies.
 *
 * @since 0.1.0
 * @category models
 */
export type FlagFilters = NonNullable<FeatureFlags.CreateFeatureFlagRequest["filters"]>;

/**
 * A feature flag, narrowed from the SDK output.
 *
 * @since 0.1.0
 * @category models
 */
export interface PostHogFeatureFlagRecord {
  id: number;
  key: string;
  name: Option.Option<string>;
  active: boolean;
  filters: Record<string, unknown>;
  tags: unknown[];
  created_at: Option.Option<string>;
  updated_at: Option.Option<string>;
}

/**
 * A survey, narrowed from the SDK output.
 *
 * @since 0.1.0
 * @category models
 */
export interface PostHogSurveyRecord {
  id: string;
  name: Option.Option<string>;
  description: Option.Option<string>;
  type: Option.Option<string>;
  start_date: Option.Option<string>;
  end_date: Option.Option<string>;
  created_at: Option.Option<string>;
  updated_at: Option.Option<string>;
}

/**
 * A non-2xx response from PostHog's REST API. `body` is truncated to
 * {@link MAX_ERROR_BODY_CHARS} — PostHog error responses can echo back
 * request bodies containing `secret_api_token`, and this error surfaces in
 * deploy logs (SEC-SECRET-002).
 *
 * @since 0.1.0
 * @category errors
 */
export class PostHogApiError extends Schema.TaggedError<PostHogApiError>()("PostHogApiError", {
  status: Schema.Number,
  method: Schema.String,
  path: Schema.String,
  body: Schema.String,
}) {
  // fallow-ignore-next-line unused-class-member -- `message` is read by `Error.prototype.toString` and every log line, never by name from this package.
  override get message(): string {
    return `PostHog API ${this.method} ${this.path} failed with ${this.status}`;
  }
}

/**
 * Failed when a provider runs without `POSTHOG_API_KEY`.
 *
 * @since 0.1.0
 * @category errors
 */
export class PostHogApiNotConfiguredError extends Schema.TaggedError<PostHogApiNotConfiguredError>()(
  "PostHogApiNotConfiguredError",
  {},
) {
  // fallow-ignore-next-line unused-class-member -- `message` is read by `Error.prototype.toString` and every log line, never by name from this package.
  override get message(): string {
    return "PostHog credentials are not configured. Set POSTHOG_API_KEY.";
  }
}

/**
 * One line for an arbitrary cause, without `String(cause)`'s failure mode on
 * an object that cannot convert to a primitive (a test runner's serialised
 * clone, a null-prototype record).
 */
const describeCause = (cause: unknown): string =>
  Predicate.isError(cause)
    ? `${cause.name}: ${cause.message}`
    : Predicate.isString(cause)
      ? cause
      : Predicate.hasProperty(cause, "toString")
        ? String(cause)
        : "[unknown]";

/**
 * Wraps a rejection that isn't one of the modelled PostHog errors (a network
 * or JSON-parse failure from `fetch`, an SDK response missing a required
 * field) so the Effect error channel stays a discriminated union of tagged
 * errors rather than collapsing to the global `Error` type. The original
 * cause is preserved for diagnostics.
 *
 * @since 0.1.0
 * @category errors
 */
export class PostHogUnexpectedError extends Schema.TaggedError<PostHogUnexpectedError>()(
  "PostHogUnexpectedError",
  { cause: Schema.Unknown },
) {
  // fallow-ignore-next-line unused-class-member -- `message` is read by `Error.prototype.toString` and every log line, never by name from this package.
  override get message(): string {
    return `Unexpected PostHog API error: ${describeCause(this.cause)}`;
  }
}

const requireApiKey = (settings: PostHogSettings) => {
  if (Option.isNone(settings.apiKey)) {
    throw new PostHogApiNotConfiguredError();
  }

  return settings.apiKey.value;
};

const createRequestInit = (method: string, apiKey: string, body?: unknown): RequestInit => {
  const headers = { Accept: "application/json", Authorization: `Bearer ${apiKey}` };
  if (body === undefined) return { method, headers };
  return {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
};

/**
 * Error bodies are truncated to this many characters before being stored on
 * {@link PostHogApiError} (SEC-SECRET-002).
 *
 * @since 0.1.0
 * @category constants
 */
export const MAX_ERROR_BODY_CHARS = 200;

const decodeResponse = async <T>(response: Response, method: string, path: string) => {
  const text = await response.text();

  if (!response.ok) {
    throw new PostHogApiError({
      status: response.status,
      method,
      path,
      body: text.slice(0, MAX_ERROR_BODY_CHARS),
    });
  }

  if (!text) {
    // SAFETY: an empty 2xx body (a 204 on delete) is what a `void` request
    // resolves to; the callers that read a record never receive one.
    return undefined as T;
  }

  // SAFETY: the deliberate lenient-decode boundary — `T` describes the bytes
  // off PostHog's REST API, materialised as parsed; see the record docs.
  return JSON.parse(text) as T;
};

const request = <T>(settings: PostHogSettings, method: string, path: string, body?: unknown) =>
  Effect.tryPromise({
    try: async () => {
      const apiKey = requireApiKey(settings);
      // oxlint-disable-next-line effect/avoid-native-fetch -- the one hand-written REST call: the vendored SDK has no environment retrieve to derive it from, and the SDK's own `HttpClient` layer carries no request-shaping this call could reuse.
      const response = await fetch(
        `${settings.baseUrl}${path}`,
        createRequestInit(method, apiKey, body),
      );

      return decodeResponse<T>(response, method, path);
    },
    // Pass the modelled errors through unchanged so downstream predicates
    // (`isNotFoundError`) can still match them by `instanceof`; only genuinely
    // unexpected rejections get wrapped in a tagged error.
    catch: (cause) =>
      cause instanceof PostHogApiError || cause instanceof PostHogApiNotConfiguredError
        ? cause
        : new PostHogUnexpectedError({ cause }),
  });

const sdkLayer = (settings: PostHogSettings) =>
  Layer.mergeAll(
    FetchHttpClient.layer,
    Layer.succeed(
      PostHogSdk.Credentials,
      Effect.succeed({
        apiBaseUrl: settings.baseUrl,
        // Seam: the SDK's `Credentials` takes a plain string. `runWithSdk`
        // has already rejected the absent case, so the `""` fallback is
        // unreachable — it exists only to satisfy the SDK's type.
        apiKey: Option.getOrUndefined(settings.apiKey) ?? "",
      }),
    ),
  );

const runWithSdk = <A, E>(
  settings: PostHogSettings,
  effect: Effect.Effect<A, E, PostHogSdk.Credentials | HttpClient.HttpClient>,
): Effect.Effect<A, E | PostHogApiNotConfiguredError> => {
  if (Option.isNone(settings.apiKey)) {
    return Effect.fail(new PostHogApiNotConfiguredError());
  }

  return effect.pipe(Effect.provide(sdkLayer(settings)));
};

/**
 * Whether a failure is PostHog's 404 — the read paths turn it into "absent".
 *
 * @example
 * ```ts
 * import { isNotFoundError, PostHogApiError } from "@thomasfosterau/effect-web-posthog/alchemy"
 *
 * isNotFoundError(new PostHogApiError({ status: 404, method: "GET", path: "/x", body: "" })) // true
 * isNotFoundError(new PostHogApiError({ status: 500, method: "GET", path: "/x", body: "" })) // false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isNotFoundError = (error: unknown): error is PostHogApiError =>
  error instanceof PostHogApiError && error.status === 404;

/**
 * Fails with {@link PostHogUnexpectedError} when a response field the local
 * record contract requires is absent — the SDK output schemas mark every
 * field optional (verified against `FeatureFlagOutput` in
 * `@distilled.cloud/posthog/feature_flags` and `Survey` in
 * `@distilled.cloud/posthog/surveys`), so the
 * requirement is enforced here, once, instead of being cast away at each
 * call site. This is the deliberate lenient-decode boundary for
 * {@link PostHogFeatureFlagRecord} / {@link PostHogSurveyRecord}: those
 * exported record types stay hand-written and required-field rather than
 * mirroring the SDK's fully-optional shape, precisely so callers don't have
 * to.
 */
const requireField = <T>(
  value: Option.Option<T>,
  record: string,
  field: string,
): Effect.Effect<T, PostHogUnexpectedError> =>
  Option.isNone(value)
    ? Effect.fail(
        new PostHogUnexpectedError({
          cause: `PostHog ${record} response is missing required "${field}"`,
        }),
      )
    : Effect.succeed(value.value);

/*
 * The three `Sdk*Output` interfaces below are hand-written MIRRORS of
 * `@distilled.cloud/posthog`'s operation output types — they exist so
 * `to*Record` can be typed against the subset of fields it reads. They are not
 * migrated to `Option`, and cannot be: the values assigned to them come
 * straight out of the external SDK, which returns plain `undefined` / `null`.
 * An `Option`-typed mirror would simply stop accepting the SDK's return value.
 * `Option` enters one line later, at the `Option.fromNullishOr` calls in each
 * `to*Record` — that is the seam.
 *
 * Deriving them from the SDK's exported types instead (`Pick<FeatureFlagOutput,
 * ...>`) would also clear the rule, but is a redesign rather than a lint fix:
 * the survey operations return TWO different output types
 * (`SurveySerializerCreateUpdateOnlyOutput` from create/patch, `Survey` from
 * retrieve), and this hand-written shape is their deliberate structural common
 * denominator.
 */
/* oxlint-disable effect/prefer-option-over-null -- external SDK mirror: these describe `@distilled.cloud/posthog`'s own return types, which are plain-optional. Option starts at the `Option.fromNullishOr` seam in `to*Record` below. */
/** The SDK feature-flag output fields the local record reads (all optional there). */
interface SdkFeatureFlagOutput {
  readonly id?: number | undefined;
  readonly key?: string | undefined;
  readonly name?: string | undefined;
  readonly active?: boolean | undefined;
  readonly filters?: { readonly [key: string]: unknown } | undefined;
  readonly tags?: readonly unknown[] | undefined;
  readonly created_at?: string | undefined;
  readonly updated_at?: string | null | undefined;
}

const toFeatureFlagRecord: (
  output: SdkFeatureFlagOutput,
) => Effect.Effect<PostHogFeatureFlagRecord, PostHogUnexpectedError> = Effect.fn(
  "toFeatureFlagRecord",
)(function* (output: SdkFeatureFlagOutput) {
  const id = yield* requireField(Option.fromNullishOr(output.id), "feature flag", "id");
  const key = yield* requireField(Option.fromNullishOr(output.key), "feature flag", "key");
  return {
    id,
    key,
    name: Option.fromNullishOr(output.name),
    active: output.active === true,
    filters: { ...output.filters },
    tags: Array.from(output.tags ?? []),
    created_at: Option.fromNullishOr(output.created_at),
    updated_at: Option.fromNullishOr(output.updated_at),
  };
});

/** The SDK survey output fields the local record reads (all optional there; no `updated_at`). */
interface SdkSurveyOutput {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly type?: string | undefined;
  readonly start_date?: string | null | undefined;
  readonly end_date?: string | null | undefined;
  readonly created_at?: string | undefined;
}

const toSurveyRecord: (
  output: SdkSurveyOutput,
) => Effect.Effect<PostHogSurveyRecord, PostHogUnexpectedError> = Effect.fn("toSurveyRecord")(
  function* (output: SdkSurveyOutput) {
    const id = yield* requireField(Option.fromNullishOr(output.id), "survey", "id");
    return {
      id,
      name: Option.fromNullishOr(output.name),
      description: Option.fromNullishOr(output.description),
      type: Option.fromNullishOr(output.type),
      start_date: Option.fromNullishOr(output.start_date),
      end_date: Option.fromNullishOr(output.end_date),
      created_at: Option.fromNullishOr(output.created_at),
      // The SDK survey output carries no `updated_at`; the local record
      // keeps the column for parity with the REST payloads.
      updated_at: Option.none(),
    };
  },
);

/** The SDK dashboard output fields the local record reads (all optional there). */
interface SdkDashboardOutput {
  readonly id?: number | undefined;
  readonly name?: string | null | undefined;
  readonly description?: string | undefined;
  readonly pinned?: boolean | undefined;
  readonly tags?: readonly unknown[] | undefined;
  readonly created_at?: string | undefined;
}
/* oxlint-enable effect/prefer-option-over-null */

const toDashboardRecord: (
  output: SdkDashboardOutput,
) => Effect.Effect<PostHogDashboardRecord, PostHogUnexpectedError> = Effect.fn("toDashboardRecord")(
  function* (output: SdkDashboardOutput) {
    const id = yield* requireField(Option.fromNullishOr(output.id), "dashboard", "id");
    // The SDK types `name` as `string | null`; `Option.fromNullishOr` maps
    // BOTH `null` and `undefined` to `None`, so `requireField` rejects both as
    // "missing" — the local record keeps `name` non-nullable, matching the
    // REST payloads.
    const name = yield* requireField(Option.fromNullishOr(output.name), "dashboard", "name");
    return {
      id,
      name,
      description: Option.fromNullishOr(output.description),
      tags: (output.tags ?? []).filter((tag): tag is string => typeof tag === "string"),
      pinned: output.pinned === true,
      created_at: Option.fromNullishOr(output.created_at),
    };
  },
);

/**
 * Drop keys whose value is `undefined` so an optional field can be forwarded
 * to the SDK operation inputs. Those inputs type optionals as `name?: string`
 * (no `| undefined`); under `exactOptionalPropertyTypes` an explicit
 * `{ name: maybeUndefined }` is rejected, so undefined-valued keys have to be
 * omitted rather than passed through. Omitting also matches the intended wire
 * semantics — a create/patch leaves the field untouched rather than clearing it.
 */
const compact = <T extends Record<string, unknown>>(
  fields: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  // SAFETY: the filter removes exactly the `undefined`-valued keys, which is
  // what the mapped type states; nothing else about the shape changes.
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };

/**
 * The management-API client the resource providers share: hand-written REST
 * for environments (the vendored SDK has no basic environment retrieve) and
 * SDK-derived CRUD for dashboards, feature flags and surveys. Every operation
 * fails with `PostHogApiNotConfiguredError` when `apiKey` is `None`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { createPostHogApi } from "@thomasfosterau/effect-web-posthog/alchemy"
 *
 * const api = createPostHogApi({ baseUrl: "https://eu.posthog.com", apiKey: Option.none() })
 * const exit = await Effect.runPromiseExit(api.getDashboard({ projectId: "1", id: 2 }))
 * exit._tag // "Failure" — no key configured, no request made
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const createPostHogApi = (settings: PostHogSettings) => ({
  getEnvironment: (input: { projectId: string; environmentId: number }) =>
    request<PostHogEnvironmentRecord>(
      settings,
      "GET",
      `/api/projects/${encodeURIComponent(input.projectId)}/environments/${encodeURIComponent(String(input.environmentId))}/`,
    ),

  refreshProjectToken: (input: { projectId: string; environmentId: number }) =>
    runWithSdk(
      settings,
      Environments.environmentsResetTokenPartialUpdate({
        id: input.environmentId,
        project_id: input.projectId,
      }),
    ),

  rotateSecretToken: (input: { projectId: string; environmentId: number }) =>
    runWithSdk(
      settings,
      Environments.environmentsRotateSecretTokenPartialUpdate({
        id: input.environmentId,
        project_id: input.projectId,
      }),
    ),

  getDashboard: (input: { projectId: string; id: number }) =>
    runWithSdk(
      settings,
      Dashboards.getDashboard({ id: input.id, project_id: input.projectId }),
    ).pipe(Effect.flatMap(toDashboardRecord)),

  createDashboard: (input: {
    projectId: string;
    name: string;
    description?: string;
    tags?: string[];
    pinned?: boolean;
  }) =>
    runWithSdk(
      settings,
      Dashboards.createDashboard({
        project_id: input.projectId,
        name: input.name,
        ...compact({
          description: input.description,
          tags: input.tags,
          pinned: input.pinned,
        }),
      }),
    ).pipe(Effect.flatMap(toDashboardRecord)),

  updateDashboard: (input: {
    projectId: string;
    id: number;
    name?: string;
    description?: string;
    tags?: string[];
    pinned?: boolean;
  }) =>
    runWithSdk(
      settings,
      Dashboards.updateDashboardsPartial({
        id: input.id,
        project_id: input.projectId,
        ...compact({
          name: input.name,
          description: input.description,
          tags: input.tags,
          pinned: input.pinned,
        }),
      }),
    ).pipe(Effect.flatMap(toDashboardRecord)),

  deleteDashboard: (input: { projectId: string; id: number }) =>
    runWithSdk(
      settings,
      Dashboards.dashboardsDestroy({ id: input.id, project_id: input.projectId }),
    ),

  createFeatureFlag: (input: {
    projectId: string;
    key: string;
    name?: string;
    active?: boolean;
    filters?: FlagFilters;
    tags?: string[];
  }) =>
    runWithSdk(
      settings,
      FeatureFlags.createFeatureFlag({
        project_id: input.projectId,
        key: input.key,
        ...compact({
          name: input.name,
          active: input.active,
          filters: input.filters,
          tags: input.tags,
        }),
      }),
    ).pipe(Effect.flatMap(toFeatureFlagRecord)),

  getFeatureFlag: (input: { projectId: string; id: number }) =>
    runWithSdk(
      settings,
      FeatureFlags.getFeatureFlag({ id: input.id, project_id: input.projectId }),
    ).pipe(Effect.flatMap(toFeatureFlagRecord)),

  updateFeatureFlag: (input: {
    projectId: string;
    id: number;
    name?: string;
    active?: boolean;
    filters?: FlagFilters;
    tags?: string[];
  }) =>
    runWithSdk(
      settings,
      FeatureFlags.updateFeatureFlagsPartial({
        id: input.id,
        project_id: input.projectId,
        ...compact({
          name: input.name,
          active: input.active,
          filters: input.filters,
          tags: input.tags,
        }),
      }),
    ).pipe(Effect.flatMap(toFeatureFlagRecord)),

  deleteFeatureFlag: (input: { projectId: string; id: number }) =>
    runWithSdk(
      settings,
      FeatureFlags.featureFlagsDestroy({ id: input.id, project_id: input.projectId }),
    ),

  createSurvey: (input: {
    projectId: string;
    name?: string;
    description?: string;
    type?: "popover" | "widget" | "external_survey" | "api";
  }) =>
    runWithSdk(
      settings,
      Surveys.createSurvey({
        project_id: input.projectId,
        ...compact({
          name: input.name,
          description: input.description,
          type: input.type,
        }),
      }),
    ).pipe(Effect.flatMap(toSurveyRecord)),

  getSurvey: (input: { projectId: string; id: string }) =>
    runWithSdk(settings, Surveys.getSurvey({ id: input.id, project_id: input.projectId })).pipe(
      Effect.flatMap(toSurveyRecord),
    ),

  updateSurvey: (input: {
    projectId: string;
    id: string;
    name?: string;
    description?: string;
    type?: "popover" | "widget" | "external_survey" | "api";
  }) =>
    runWithSdk(
      settings,
      Surveys.updateSurveysPartial({
        id: input.id,
        project_id: input.projectId,
        ...compact({
          name: input.name,
          description: input.description,
          type: input.type,
        }),
      }),
    ).pipe(Effect.flatMap(toSurveyRecord)),

  deleteSurvey: (input: { projectId: string; id: string }) =>
    runWithSdk(settings, Surveys.surveysDestroy({ id: input.id, project_id: input.projectId })),
});
