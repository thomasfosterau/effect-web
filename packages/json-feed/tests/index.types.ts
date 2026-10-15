/**
 * Compile-time assertions for the JSON Feed input shapes: an item needs
 * `content_html` or `content_text`, an author at least one member. Every
 * binding is exported so an unused-local error can never stand in for the
 * assertion a directive expects.
 */
import type { JsonFeedAuthor, JsonFeedEntry } from "@thomasfosterau/effect-json-feed";

export const html: JsonFeedEntry = { path: "/a", contentHtml: "<p>A</p>" };
export const text: JsonFeedEntry = { path: "/a", contentText: "A" };

// @ts-expect-error — an entry with no content.
export const noContent: JsonFeedEntry = { path: "/a", title: "A" };

export const named: JsonFeedAuthor = { name: "Ada" };
export const linked: JsonFeedAuthor = { url: "/ada" };
export const pictured: JsonFeedAuthor = { avatar: "/ada.png" };

// @ts-expect-error — an author with no member.
export const empty: JsonFeedAuthor = {};
