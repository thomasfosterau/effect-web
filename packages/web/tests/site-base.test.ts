/**
 * The canonical site base: the normalising check, and the total config read
 * that falls back to the application's own origin.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as References from "effect/References";
import { normalizeSiteBase, siteBase } from "@thomasfosterau/effect-web";

const FALLBACK = "https://example.com";
const linkBase = siteBase({ key: "PUBLIC_SITE_URL", fallback: FALLBACK });

/** Runs `linkBase` under `provider`, recording each log line's level and annotations. */
const read = async (provider: ConfigProvider.ConfigProvider, effect = linkBase) => {
  const lines: Array<{ level: string; annotations: Record<string, unknown> }> = [];
  const logger = Logger.make(({ logLevel, fiber }) => {
    lines.push({
      level: logLevel,
      annotations: { ...fiber.getRef(References.CurrentLogAnnotations) },
    });
  });
  const value = await Effect.runPromise(
    effect.pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, provider),
      Effect.provide(Logger.layer([logger])),
    ),
  );
  return { value, lines };
};

describe("normalizeSiteBase", () => {
  it("accepts an absolute http(s) origin and returns it without a trailing slash", () => {
    expect(normalizeSiteBase("https://example.com")).toStrictEqual(Option.some(FALLBACK));
    expect(normalizeSiteBase("https://example.com/")).toStrictEqual(Option.some(FALLBACK));
    expect(normalizeSiteBase("  https://EXAMPLE.com:443/ ")).toStrictEqual(Option.some(FALLBACK));
    expect(normalizeSiteBase("http://localhost:5173")).toStrictEqual(
      Option.some("http://localhost:5173"),
    );
  });

  it("refuses anything that is not a bare http(s) origin", () => {
    const refused = [
      "",
      "example.com",
      "/posts",
      "ftp://example.com",
      "javascript:alert(1)",
      "https://user:pass@example.com",
      "https://example.com/blog",
      "https://example.com/?q=1",
      "https://example.com/#top",
    ];
    expect(Arr.map(refused, normalizeSiteBase)).toStrictEqual(
      Arr.map(refused, () => Option.none()),
    );
  });
});

describe("siteBase", () => {
  it("reads and normalises the configured base, logging nothing", async () => {
    const { value, lines } = await read(
      ConfigProvider.fromUnknown({ PUBLIC_SITE_URL: "https://www.example.com/" }),
    );
    expect(value).toBe("https://www.example.com");
    expect(lines).toStrictEqual([]);
  });

  it("falls back when the key is absent", async () => {
    const { value, lines } = await read(ConfigProvider.fromUnknown({}));
    expect(value).toBe(FALLBACK);
    expect(lines).toStrictEqual([]);
  });

  it("falls back when the provider fails, keeping the error channel never", async () => {
    const failing = ConfigProvider.make(() =>
      Effect.fail(new ConfigProvider.SourceError({ message: "store unreachable" })),
    );
    expect((await read(failing)).value).toBe(FALLBACK);
  });

  it("falls back on an invalid value after one site-base.invalid warning", async () => {
    const { value, lines } = await read(
      ConfigProvider.fromUnknown({ PUBLIC_SITE_URL: "https://preview.example.workers.dev/app" }),
    );
    expect(value).toBe(FALLBACK);
    expect(lines).toStrictEqual([
      {
        level: "Warn",
        annotations: {
          event: "site-base.invalid",
          key: "PUBLIC_SITE_URL",
          value: "https://preview.example.workers.dev/app",
        },
      },
    ]);
  });

  it("normalises the fallback, and uses a fallback that is no origin as given", async () => {
    const empty = ConfigProvider.fromUnknown({});
    expect(
      (await read(empty, siteBase({ key: "PUBLIC_SITE_URL", fallback: "https://example.com/" })))
        .value,
    ).toBe(FALLBACK);
    expect(
      (await read(empty, siteBase({ key: "PUBLIC_SITE_URL", fallback: "not a url" }))).value,
    ).toBe("not a url");
  });
});
