/**
 * A controllable Permissions API for tests of code that uses
 * `@effect/platform-browser`'s `Permissions` (and `./browser`'s
 * `PermissionStatus`, which builds on it): {@link layer} provides
 * `Permissions` over an in-memory permission table, plus {@link Control} to
 * grant, deny or reset a permission. Each `query` returns a live status
 * whose `change` event fires on every later change, as the browser's does.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import * as Permissions from "@effect/platform-browser/Permissions";

/**
 * The in-memory table's starting states, per permission name. A name not
 * listed starts at `"prompt"`.
 *
 * @since 0.2.0
 * @category models
 */
export type States = Readonly<Partial<Record<PermissionName, PermissionState>>>;

/**
 * Drives the in-memory table: `set` changes a permission's state and fires
 * `change` on every status queried for it (a no-op when unchanged).
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  { readonly set: (name: PermissionName, state: PermissionState) => Effect.Effect<void> }
>()("@thomasfosterau/effect-web/testing/PermissionsControl") {}

/** A permission status whose `state` reads the double's live table. */
class TestPermissionStatus<Name extends PermissionName> extends EventTarget {
  readonly name: Name;
  onchange: ((this: PermissionStatus, event: Event) => void) | null = null;
  readonly #read: () => PermissionState;
  constructor(name: Name, read: () => PermissionState) {
    super();
    this.name = name;
    this.#read = read;
  }
  get state(): PermissionState {
    return this.#read();
  }
}

const PERMISSIONS_TYPE_ID = "~@effect/platform-browser/Permissions";

/**
 * What {@link make} builds: the `Permissions` service over the in-memory
 * permission table, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly permissions: Permissions.Permissions;
  readonly control: Control["Service"];
}

/**
 * Builds an in-memory permission table: the `Permissions` service over it,
 * and its {@link Control}. Names in `unsupported` fail their `query` with a
 * `PermissionsError` (`TypeError` reason), as a browser rejects a
 * permission name it does not know.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestPermissions } from "@thomasfosterau/effect-web/testing"
 *
 * const { permissions, control } = TestPermissions.make({ camera: "denied" })
 * const program = Effect.andThen(control.set("camera", "granted"), permissions.query("camera"))
 * Effect.runPromise(program).then((status) => console.log(status.state)) // "granted"
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (initial?: States, unsupported?: ReadonlyArray<PermissionName>): Fixture => {
  const changed = MutableHashMap.empty<PermissionName, PermissionState>();
  const statuses: Array<{ readonly name: PermissionName; readonly status: EventTarget }> = [];
  const stateOf = (name: PermissionName): PermissionState =>
    Option.getOrElse(MutableHashMap.get(changed, name), () => initial?.[name] ?? "prompt");
  const permissions: Permissions.Permissions = Permissions.Permissions.of({
    [PERMISSIONS_TYPE_ID]: PERMISSIONS_TYPE_ID,
    query: <Name extends PermissionName>(name: Name) =>
      (unsupported ?? []).includes(name)
        ? Effect.fail(
            new Permissions.PermissionsError({
              reason: new Permissions.PermissionsTypeError({
                // The shape of the browser's rejection, a `TypeError`.
                cause: { name: "TypeError", message: `'${name}' is not a valid permission name` },
              }),
            }),
          )
        : Effect.sync(() => {
            const status = new TestPermissionStatus(name, () => stateOf(name));
            statuses.push({ name, status });
            return status;
          }),
  });
  return {
    permissions,
    control: Control.of({
      set: (name, state) =>
        Effect.sync(() => {
          if (stateOf(name) === state) return;
          MutableHashMap.set(changed, name, state);
          statuses
            .filter((entry) => entry.name === name)
            .forEach((entry) => entry.status.dispatchEvent(new Event("change")));
        }),
    }),
  };
};

/**
 * Provides `Permissions` over a fresh in-memory table (see {@link make}),
 * and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { PermissionStatus } from "@thomasfosterau/effect-web/browser"
 * import { TestPermissions } from "@thomasfosterau/effect-web/testing"
 *
 * Effect.runPromise(
 *   Effect.provide(PermissionStatus.state("microphone"), TestPermissions.layer()),
 * ).then(console.log) // "prompt"
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (
  initial?: States,
  unsupported?: ReadonlyArray<PermissionName>,
): Layer.Layer<Permissions.Permissions | Control> =>
  Layer.syncContext(() => {
    const { permissions, control } = make(initial, unsupported);
    return Context.make(Permissions.Permissions, permissions).pipe(Context.add(Control, control));
  });
