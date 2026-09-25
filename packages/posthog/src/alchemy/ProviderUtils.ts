/**
 * What every PostHog resource provider shares: the not-found read-throughs, the identity-based `diff`, and the provider factory.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import type { ResourceClass, ResourceClassLike, ResourceLike } from "alchemy/Resource";
import { createPostHogApi, isNotFoundError } from "./Api.ts";
import { PostHogConfig } from "./Config.ts";

/**
 * Build provider-specific handlers that translate "resource not found"
 * errors into either `undefined` (for read paths) or `void` (for delete
 * paths). The provider-specific `isNotFoundError` predicate is supplied
 * by the caller.
 */
const createMissingHandlers = (isNotFoundError: (error: unknown) => boolean) => {
  const catchMissing = <A>(onMissing: Effect.Effect<A, never>) =>
    Effect.catch((error: unknown) => (isNotFoundError(error) ? onMissing : Effect.fail(error)));

  return {
    // Read path: `undefined` is the VALUE a missing resource resolves to, so
    // this one keeps `Effect.succeed(undefined)` — `Effect.void` would widen
    // the success channel from `A | undefined` to `A | void`.
    withMissingAsUndefined: <A>(effect: Effect.Effect<A, unknown>) =>
      effect.pipe(catchMissing(Effect.succeed(undefined))),
    // Delete path: the success channel is already `void`, which is exactly
    // what `Effect.void` expresses.
    ignoreMissingOnDelete: (effect: Effect.Effect<void, unknown>) =>
      effect.pipe(catchMissing(Effect.void)),
  };
};

/**
 * Reads through a REST 404 as `undefined` — the "resource is gone" value a
 * provider's `read` resolves to.
 *
 * @since 0.1.0
 * @category combinators
 */
export const withMissingAsUndefined: <A>(
  effect: Effect.Effect<A, unknown>,
) => Effect.Effect<A | undefined, unknown> =
  createMissingHandlers(isNotFoundError).withMissingAsUndefined;

const isSdkNotFoundError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === "NotFound";

/**
 * Reassert a `Resource(...)` class as `ResourceClassLike` for the alchemy
 * `Provider.*` seams. alchemy beta.62 types `ResourceClassLike.Aliases` as
 * `readonly string[]` (optional, no `| undefined`) while `ResourceClass` carries
 * `Aliases: readonly string[] | undefined`; under this repo's
 * `exactOptionalPropertyTypes` the two are incompatible, so `Provider.effect` /
 * `Provider.collection` reject a resource class directly. The cast is a pure
 * type coercion — the runtime value is the real class, so `.Type` / `.Aliases` /
 * `.Provider` are all still present.
 *
 * `Provider.collection` additionally can't infer its `Provider<R>` requirement
 * from a `ResourceClassLike` (its requirement conditional matches `ResourceClass`,
 * not the `Like` shape it constrains on — an upstream inconsistency), so that
 * requirement collapses to `never` there; the explicit `Layer.provide(...)` calls
 * in {@link ./Providers} still wire each provider at runtime. Drop once upstream
 * aligns the `Aliases` types and the collection constraint/return.
 *
 * Still needed as of alchemy 2.0.0-beta.63 (checked during #1114, which also
 * checked beta.64 before reverting to beta.63 for an unrelated Python-Worker
 * regression — see the PR body): both types are unchanged in
 * `node_modules/alchemy/lib/Resource.d.ts` — `Aliases?: readonly string[]` on
 * `ResourceClassLike`, `Aliases: readonly string[] | undefined` on
 * `ResourceClass`. Re-check on the next alchemy bump.
 */
/**
 * @since 0.1.0
 * @category utilities
 */
export const asClassLike = <R extends ResourceLike>(
  resource: ResourceClass<R>,
): ResourceClassLike<R> =>
  // SAFETY: a pure type coercion — the runtime value is the real class, so
  // `.Type` / `.Aliases` / `.Provider` are all present; see the note above.
  // oxlint-disable-next-line effect/no-chained-type-assertions -- the two `Aliases` declarations are structurally incompatible under `exactOptionalPropertyTypes`, so no single assertion is admitted.
  resource as unknown as ResourceClassLike<R>;

/**
 * Reads through the SDK's tagged `NotFound` as `undefined` (a `void` success).
 *
 * @since 0.1.0
 * @category combinators
 */
export const withSdkMissingAsUndefined = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.catch((error: unknown) =>
      isSdkNotFoundError(error) ? Effect.void : Effect.fail(error),
    ),
  );

/**
 * The client {@link createPostHogApi} builds.
 *
 * @since 0.1.0
 * @category models
 */
export type PostHogApi = ReturnType<typeof createPostHogApi>;

/**
 * A `replace`-on-identity-change `diff`, shared across every PostHog
 * resource: each is immutable along a fixed set of props (a project id,
 * plus whatever else forms the resource's real-world identity) and mutable
 * everywhere else. `identity` extracts that comparison key from props.
 */
const replaceOnIdentityChange =
  <Props extends object>(identity: (props: Partial<Props>) => ReadonlyArray<unknown>) =>
  (input: { olds?: Partial<Props>; news?: Partial<Props> }) => {
    const { olds = {}, news = {} } = input;
    if (!isResolved(news)) {
      return Effect.void;
    }

    const oldKey = identity(olds);
    const newKey = identity(news);
    const replaced =
      oldKey.length !== newKey.length || oldKey.some((value, index) => value !== newKey[index]);

    return Effect.succeed(replaced ? { action: "replace" as const } : undefined);
  };

/**
 * Builds a PostHog resource's `Provider.effect` layer from a lifecycle spec,
 * factoring out the config/api wiring, the `stables`/`list` defaults, and the
 * identity-based `diff` every PostHog resource shares — while leaving
 * `reconcile`/`delete`/`read` (where the resources genuinely differ: REST vs
 * SDK calls, different attribute shapes, whether a `delete` prop is honoured)
 * to be supplied verbatim by each resource module.
 */
/**
 * @since 0.1.0
 * @category constructors
 */
export const postHogResourceProvider = <Res extends ResourceLike>(config: {
  resource: ResourceClass<Res>;
  /** Props forming the resource's real-world identity — a change forces `replace`. */
  identity: (props: Partial<Res["Props"]>) => ReadonlyArray<unknown>;
  stables?: ReadonlyArray<Extract<keyof Res["Attributes"], string>>;
  list?: () => Effect.Effect<Res["Attributes"][]>;
  reconcile: (api: PostHogApi) => Provider.ProviderService<Res>["reconcile"];
  delete: (api: PostHogApi) => Provider.ProviderService<Res>["delete"];
  read: (api: PostHogApi) => NonNullable<Provider.ProviderService<Res>["read"]>;
}) =>
  Provider.effect(
    asClassLike(config.resource),
    Effect.gen(function* () {
      const settings = yield* PostHogConfig;
      const api = createPostHogApi(settings);

      return config.resource.Provider.of({
        stables: config.stables ? [...config.stables] : [],
        // Non-listable: managed individually, no account-wide enumeration.
        list: config.list ?? (() => Effect.succeed([])),
        // SAFETY: alchemy's `diff` is typed over the resource's exact
        // `Props`; the identity-based diff is generic over `Partial<Props>`
        // and reads only the keys `identity` names.
        diff: replaceOnIdentityChange(config.identity) as never,
        reconcile: config.reconcile(api),
        delete: config.delete(api),
        read: config.read(api),
      });
    }),
  );
