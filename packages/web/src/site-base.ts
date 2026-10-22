/**
 * The canonical site base: the one origin every absolute URL an application
 * builds about itself is resolved on (a JSON:API `links.self`, a sitemap
 * `<loc>`, a feed item, a canonical link). It comes from configuration,
 * never the request origin, so a page fetched from a preview host still
 * names production (CANON-001).
 *
 * @since 0.2.0
 */
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Where {@link siteBase} reads the base from, and what it falls back to.
 * Both are the application's: this package ships no default host.
 *
 * @since 0.2.0
 * @category models
 */
export interface SiteBaseOptions {
  /** The config key (`PUBLIC_SITE_URL`), read through the ambient `ConfigProvider`. */
  readonly key: string;
  /** The application's own production origin, used when the key is absent, unreadable or invalid. */
  readonly fallback: string;
}

const parseUrl = Option.liftThrowable((value: string) => new URL(value));

const isSiteOrigin = (url: URL): boolean =>
  (url.protocol === "https:" || url.protocol === "http:") &&
  url.username === "" &&
  url.password === "" &&
  url.pathname === "/" &&
  url.search === "" &&
  url.hash === "";

/**
 * A configured base as a site origin: an absolute `http(s)` URL with no
 * credentials, path, query or fragment, normalised to its origin
 * (`https://example.com`, no trailing slash, the host lower-cased, a default
 * port dropped). `None` for anything else. A base with a path is refused
 * rather than kept, because a site-root-relative path resolved on it
 * (`new URL("/posts/1", base)`) drops that path anyway.
 *
 * @example
 * ```ts
 * import { normalizeSiteBase } from "@thomasfosterau/effect-web"
 *
 * normalizeSiteBase(" https://Example.com:443/ ") // Option.some("https://example.com")
 * normalizeSiteBase("https://example.com/blog") // Option.none()
 * normalizeSiteBase("example.com") // Option.none()
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const normalizeSiteBase = (value: string): Option.Option<string> =>
  parseUrl(value.trim()).pipe(
    Option.filter(isSiteOrigin),
    Option.map((url) => url.origin),
  );

/**
 * The canonical site base, read from `options.key` through the ambient
 * `ConfigProvider` and normalised by {@link normalizeSiteBase}. Total: a
 * missing key or a provider error yields `options.fallback`, and so does an
 * invalid value, after a `site-base.invalid` warning naming the key and the
 * value, so reading the base never widens a caller's error union. The
 * fallback is normalised the same way, and used as given if it is not a
 * site origin.
 *
 * Build it once and yield it wherever an absolute URL is built, so every
 * such URL goes through the one base.
 *
 * @example
 * ```ts
 * import * as ConfigProvider from "effect/ConfigProvider"
 * import * as Effect from "effect/Effect"
 * import { siteBase } from "@thomasfosterau/effect-web"
 *
 * const linkBase = siteBase({ key: "PUBLIC_SITE_URL", fallback: "https://example.com" })
 *
 * const configured = linkBase.pipe(
 *   Effect.provideService(
 *     ConfigProvider.ConfigProvider,
 *     ConfigProvider.fromUnknown({ PUBLIC_SITE_URL: "https://www.example.com/" }),
 *   ),
 * )
 * await Effect.runPromise(configured) // "https://www.example.com"
 *
 * const unset = linkBase.pipe(
 *   Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
 * )
 * await Effect.runPromise(unset) // "https://example.com"
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const siteBase = (options: SiteBaseOptions): Effect.Effect<string> => {
  const fallback = Option.getOrElse(normalizeSiteBase(options.fallback), () => options.fallback);
  return Config.option(Config.String(options.key)).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(fallback),
        onSome: (value) =>
          Option.match(normalizeSiteBase(value), {
            onNone: () =>
              Effect.logWarning("site-base.invalid").pipe(
                Effect.annotateLogs({ event: "site-base.invalid", key: options.key, value }),
                Effect.as(fallback),
              ),
            onSome: Effect.succeed,
          }),
      }),
    ),
  );
};
