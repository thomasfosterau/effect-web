/**
 * Compile-time assertions for the RSS item shape: RSS 2.0 requires a
 * `title` or a `description` on every item. Every binding is exported so an
 * unused-local error can never stand in for the assertion a directive
 * expects.
 */
import type { RssItem } from "@thomasfosterau/effect-rss-feed";

export const titled: RssItem = { path: "/a", title: "A" };
export const described: RssItem = { path: "/a", description: "A" };
export const both: RssItem = { path: "/a", title: "A", description: "A" };

// @ts-expect-error — an item with neither a title nor a description.
export const neither: RssItem = { path: "/a" };

// @ts-expect-error — both present but undefined is still neither.
export const undefinedBoth: RssItem = { path: "/a", title: undefined, description: undefined };
