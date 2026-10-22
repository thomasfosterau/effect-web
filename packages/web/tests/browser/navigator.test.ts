/**
 * Unit tests for `./browser`'s `Navigator`, driven through `./testing`'s
 * `TestNavigator` (the real adapter over an in-memory navigator) and, for
 * the degraded paths, through `Navigator.make` over a sparse navigator.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Navigator } from "@thomasfosterau/effect-web/browser";
import { TestNavigator, observe } from "@thomasfosterau/effect-web/testing";

describe("Navigator.info", () => {
  it("reports the agent's self-description", async () => {
    const info = await Effect.runPromise(
      Effect.provide(
        Navigator.info,
        TestNavigator.layer({
          userAgent: "Agent/2",
          languages: ["en-AU", "en"],
          hardwareConcurrency: 8,
          deviceMemory: 4,
          maxTouchPoints: 5,
          globalPrivacyControl: true,
          webdriver: true,
        }),
      ),
    );
    expect(info).toStrictEqual({
      userAgent: "Agent/2",
      languages: ["en-AU", "en"],
      hardwareConcurrency: Option.some(8),
      deviceMemoryGiB: Option.some(4),
      maxTouchPoints: 5,
      cookieEnabled: true,
      pdfViewerEnabled: Option.none(),
      webdriver: true,
      globalPrivacyControl: Option.some(true),
    });
  });

  it("takes documented defaults where the agent says nothing", async () => {
    const navigator = Navigator.make({ navigator: undefined, events: undefined });
    const result = await Effect.runPromise(
      Effect.all({
        info: navigator.info,
        onLine: navigator.onLine,
        connection: navigator.connection,
        userActivation: navigator.userActivation,
        canShare: navigator.canShare({ url: "https://example.com" }),
        vibrate: navigator.vibrate(100),
        onLineChanges: Stream.runCollect(navigator.onLineChanges),
        languageChanges: Stream.runCollect(navigator.languageChanges),
        connectionChanges: Stream.runCollect(navigator.connectionChanges),
      }),
    );
    expect(result).toStrictEqual({
      info: {
        userAgent: "",
        languages: [],
        hardwareConcurrency: Option.none(),
        deviceMemoryGiB: Option.none(),
        maxTouchPoints: 0,
        cookieEnabled: false,
        pdfViewerEnabled: Option.none(),
        webdriver: false,
        globalPrivacyControl: Option.none(),
      },
      onLine: true,
      connection: Option.none(),
      userActivation: Option.none(),
      canShare: false,
      vibrate: false,
      onLineChanges: [true],
      languageChanges: [[]],
      connectionChanges: [],
    });
  });

  it("falls back from an empty `languages` to `language`", async () => {
    const languages = await Effect.runPromise(
      Navigator.make({ navigator: { languages: [], language: "de" }, events: undefined }).languages,
    );
    expect(languages).toStrictEqual(["de"]);
    const none = await Effect.runPromise(
      Navigator.make({ navigator: { language: "" }, events: undefined }).languages,
    );
    expect(none).toStrictEqual([]);
  });

  it("builds the live layer under Node", async () => {
    const info = await Effect.runPromise(Effect.provide(Navigator.info, Navigator.layer));
    expect(info.userAgent).toMatch(/Node/);
  });
});

describe("Navigator change streams", () => {
  it("emits connectivity now and on each flip, deduplicated", async () => {
    const seen = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const control = yield* TestNavigator.Control;
          const fiber = yield* observe(Navigator.onLineChanges, 3);
          yield* control.setOnLine(false);
          yield* control.setOnLine(false);
          yield* control.setOnLine(true);
          return yield* Fiber.join(fiber);
        }),
        TestNavigator.layer(),
      ),
    );
    expect(seen).toStrictEqual([true, false, true]);
  });

  it("waits for connectivity with awaitOnLine", async () => {
    const order = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const control = yield* TestNavigator.Control;
          const log: Array<string> = [];
          const fiber = yield* Effect.forkChild(
            Effect.andThen(
              Navigator.awaitOnLine,
              Effect.sync(() => log.push("online")),
            ),
          );
          log.push("still offline");
          yield* control.setOnLine(true);
          yield* Fiber.join(fiber);
          return log;
        }),
        TestNavigator.layer({ onLine: false }),
      ),
    );
    expect(order).toStrictEqual(["still offline", "online"]);
  });

  it("emits languages on languagechange, ignoring an unchanged list", async () => {
    const seen = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const control = yield* TestNavigator.Control;
          const fiber = yield* observe(Navigator.languageChanges, 2);
          yield* control.setLanguages(["en-US"]);
          yield* control.setLanguages(["fr", "en"]);
          return yield* Fiber.join(fiber);
        }),
        TestNavigator.layer(),
      ),
    );
    expect(seen).toStrictEqual([["en-US"], ["fr", "en"]]);
  });

  it("reads and follows the network connection", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const navigator = yield* Navigator.Navigator;
          const control = yield* TestNavigator.Control;
          const now = yield* navigator.connection;
          const fiber = yield* observe(navigator.connectionChanges, 2);
          yield* control.setConnection({ effectiveType: "4g", downlink: 10, rtt: 50 });
          yield* control.setConnection({ effectiveType: "2g", saveData: true });
          return { now, changes: yield* Fiber.join(fiber) };
        }),
        TestNavigator.layer({ connection: { effectiveType: "4g", downlink: 10, rtt: 50 } }),
      ),
    );
    const fourG = {
      type: Option.none(),
      effectiveType: Option.some("4g"),
      downlinkMbps: Option.some(10),
      rttMs: Option.some(50),
      saveData: false,
    };
    expect(result.now).toStrictEqual(Option.some(fourG));
    expect(result.changes).toStrictEqual([
      fourG,
      {
        type: Option.none(),
        effectiveType: Option.some("2g"),
        downlinkMbps: Option.none(),
        rttMs: Option.none(),
        saveData: true,
      },
    ]);
  });

  it("reads user activation", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const navigator = yield* Navigator.Navigator;
          const control = yield* TestNavigator.Control;
          yield* control.setUserActivation({ isActive: true, hasBeenActive: true });
          return yield* navigator.userActivation;
        }),
        TestNavigator.layer({ userActivation: { isActive: false, hasBeenActive: false } }),
      ),
    );
    expect(result).toStrictEqual(Option.some({ isActive: true, hasBeenActive: true }));
  });
});

describe("Navigator calls", () => {
  it("shares, beacons and vibrates, and records each call", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const navigator = yield* Navigator.Navigator;
          const control = yield* TestNavigator.Control;
          const canShare = yield* navigator.canShare({ text: "hi" });
          yield* Navigator.share({ text: "hi" });
          yield* Navigator.sendBeacon(new URL("https://example.com/b"), "payload");
          yield* Navigator.sendBeacon("https://example.com/empty");
          const vibrated = yield* navigator.vibrate([100, 50, 100]);
          return {
            canShare,
            vibrated,
            shares: yield* control.shares,
            beacons: yield* control.beacons,
            vibrations: yield* control.vibrations,
          };
        }),
        TestNavigator.layer(),
      ),
    );
    expect(result).toStrictEqual({
      canShare: true,
      vibrated: true,
      shares: [{ text: "hi" }],
      beacons: [
        { url: "https://example.com/b", data: Option.some("payload") },
        { url: "https://example.com/empty", data: Option.none() },
      ],
      vibrations: [[100, 50, 100]],
    });
  });

  it("maps share refusals onto reasons", async () => {
    const reasonFor = (share: "abort" | "deny" | "unsupported") =>
      Effect.runPromise(
        Effect.provide(
          Effect.map(Effect.flip(Navigator.share({ text: "x" })), (error) => [
            error.operation,
            error.reason,
            error.message,
          ]),
          TestNavigator.layer({ share: share }),
        ),
      );
    expect(await reasonFor("abort")).toStrictEqual([
      "share",
      "Aborted",
      "navigator share: Aborted",
    ]);
    expect(await reasonFor("deny")).toStrictEqual([
      "share",
      "NotAllowed",
      "navigator share: NotAllowed",
    ]);
    expect(await reasonFor("unsupported")).toStrictEqual([
      "share",
      "Unsupported",
      "navigator share: Unsupported",
    ]);
  });

  it("falls back to `share`'s presence when `canShare` is missing", async () => {
    const navigator = Navigator.make({
      navigator: { share: () => Promise.resolve() },
      events: undefined,
    });
    expect(await Effect.runPromise(navigator.canShare({}))).toBe(true);
  });

  it("fails a declined or unsupported beacon", async () => {
    const declined = await Effect.runPromise(
      Effect.provide(
        Effect.flip(Navigator.sendBeacon("https://example.com")),
        TestNavigator.layer({ beacon: "reject" }),
      ),
    );
    expect(declined.reason).toBe("Rejected");
    const unsupported = await Effect.runPromise(
      Effect.provide(
        Effect.flip(Navigator.sendBeacon("https://example.com")),
        TestNavigator.layer({ beacon: "unsupported" }),
      ),
    );
    expect(unsupported.reason).toBe("Unsupported");
    const throwing = Navigator.make({
      navigator: {
        sendBeacon: () => {
          throw new TypeError("Invalid URL");
        },
      },
      events: undefined,
    });
    const invalid = await Effect.runPromise(Effect.flip(throwing.sendBeacon("::")));
    expect(invalid.reason).toBe("InvalidData");
  });

  it("estimates storage and requests persistence", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const { storage } = yield* Navigator.Navigator;
          const before = yield* storage.persisted;
          const granted = yield* storage.persist;
          return {
            estimate: yield* storage.estimate,
            before,
            granted,
            after: yield* storage.persisted,
          };
        }),
        TestNavigator.layer({ storage: { usage: 2048, quota: 4096 } }),
      ),
    );
    expect(result).toStrictEqual({
      estimate: { usageBytes: Option.some(2048), quotaBytes: Option.some(4096) },
      before: false,
      granted: true,
      after: true,
    });
    const denied = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Navigator.Navigator, (navigator) => navigator.storage.persist),
        TestNavigator.layer({ storage: { grantPersistence: false } }),
      ),
    );
    expect(denied).toBe(false);
  });

  it("fails storage calls Unsupported without a storage manager, and maps rejections", async () => {
    const bare = Navigator.make({ navigator: {}, events: undefined });
    const unsupported = await Effect.runPromise(
      Effect.all([
        Effect.flip(bare.storage.estimate),
        Effect.flip(bare.storage.persisted),
        Effect.flip(bare.storage.persist),
      ]),
    );
    expect(unsupported.map((error) => [error.operation, error.reason])).toStrictEqual([
      ["storage.estimate", "Unsupported"],
      ["storage.persisted", "Unsupported"],
      ["storage.persist", "Unsupported"],
    ]);
    const rejecting = Navigator.make({
      navigator: {
        storage: {
          estimate: () => Promise.resolve({}),
          persisted: () => Promise.reject(new DOMException("no", "SecurityError")),
          persist: () => Promise.reject(new DOMException("busy", "InvalidStateError")),
        },
      },
      events: undefined,
    });
    const outcome = await Effect.runPromise(
      Effect.all({
        estimate: rejecting.storage.estimate,
        persisted: Effect.map(Effect.flip(rejecting.storage.persisted), (error) => error.reason),
        persist: Effect.map(Effect.flip(rejecting.storage.persist), (error) => error.reason),
      }),
    );
    expect(outcome).toStrictEqual({
      estimate: { usageBytes: Option.none(), quotaBytes: Option.none() },
      persisted: "NotAllowed",
      persist: "InvalidState",
    });
  });
});
