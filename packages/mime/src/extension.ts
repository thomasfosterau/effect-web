/**
 * File extensions and MIME types: a small curated table (images, audio
 * and video, fonts, documents, archives, web formats) with a hook for
 * custom entries. Not a copy of mime-db.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Str from "effect/String";

/**
 * An extension table: lower-case extensions, without the dot, to a MIME
 * type essence. The first extension listed for a type is its preferred
 * one (`jpg` before `jpeg`).
 *
 * @since 0.1.0
 * @category models
 */
export type ExtensionTable = Record.ReadonlyRecord<string, string>;

/**
 * The curated default table.
 *
 * @since 0.1.0
 * @category tables
 */
export const DEFAULT_EXTENSIONS: ExtensionTable = {
  // Web
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  jsonld: "application/ld+json",
  xml: "application/xml",
  xhtml: "application/xhtml+xml",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  ics: "text/calendar",
  vcf: "text/vcard",
  atom: "application/atom+xml",
  rss: "application/rss+xml",
  wasm: "application/wasm",
  webmanifest: "application/manifest+json",
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  // Audio and video
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  weba: "audio/webm",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  // Fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  ttc: "font/collection",
  eot: "application/vnd.ms-fontobject",
  // Documents
  pdf: "application/pdf",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  // Archives
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
};

/** The extension of a file name or path (`photo.JPG` → `jpg`), or the input itself, lower-cased, without a dot. */
const extensionOf = (nameOrExtension: string): string => {
  const base = nameOrExtension.slice(nameOrExtension.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return Str.toLowerCase(dot < 0 ? base : base.slice(dot + 1));
};

/**
 * The MIME type for a file name, path or bare extension, matched
 * case-insensitively; `None` for one the table does not know.
 *
 * @example
 * ```ts
 * import { Extension } from "@thomasfosterau/effect-mime"
 *
 * console.log(Extension.mimeTypeFor("Report.DOCX"))
 * // Option.some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
 * console.log(Extension.mimeTypeFor("woff2")) // Option.some("font/woff2")
 * ```
 *
 * @since 0.1.0
 * @category lookups
 */
export const mimeTypeFor = (
  nameOrExtension: string,
  table: ExtensionTable = DEFAULT_EXTENSIONS,
): Option.Option<string> => Record.get(table, extensionOf(nameOrExtension));

/**
 * The preferred extension (without the dot) for a MIME type essence: the
 * first one the table lists for it. Parameters are ignored, case is not
 * significant.
 *
 * @example
 * ```ts
 * import { Extension } from "@thomasfosterau/effect-mime"
 *
 * console.log(Extension.extensionFor("image/jpeg; q=1")) // Option.some("jpg")
 * ```
 *
 * @since 0.1.0
 * @category lookups
 */
export const extensionFor = (
  mimeType: string,
  table: ExtensionTable = DEFAULT_EXTENSIONS,
): Option.Option<string> => {
  const wanted = Str.toLowerCase(mimeType.split(";")[0]?.trim() ?? "");
  return Option.map(
    Arr.findFirst(Record.toEntries(table), ([, type]) => type === wanted),
    ([extension]) => extension,
  );
};

/**
 * A table with custom entries over a base one (by default
 * {@link DEFAULT_EXTENSIONS}); a custom entry replaces a base one with the
 * same extension. Extensions are lower-cased and a leading dot dropped.
 *
 * @example
 * ```ts
 * import { Extension } from "@thomasfosterau/effect-mime"
 *
 * const table = Extension.extend({ ".GEOJSON": "application/geo+json" })
 * console.log(Extension.mimeTypeFor("map.geojson", table)) // Option.some("application/geo+json")
 * ```
 *
 * @since 0.1.0
 * @category tables
 */
export const extend = (
  entries: Record.ReadonlyRecord<string, string>,
  base: ExtensionTable = DEFAULT_EXTENSIONS,
): ExtensionTable => ({
  ...base,
  ...Record.mapKeys(entries, (extension) => Str.toLowerCase(extension.replace(/^\./, ""))),
});
