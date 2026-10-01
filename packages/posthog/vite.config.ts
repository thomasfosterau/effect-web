import { packageConfig } from "../../vite.package.ts";

export default packageConfig({
  url: import.meta.url,
  name: "@thomasfosterau/effect-web-posthog",
  // The Alchemy providers load `alchemy` and `@distilled.cloud/posthog`
  // (effect-web#31): see `alchemyTests`.
  alchemyTests: ["tests/alchemy.test.ts"],
  entries: ["index", "alchemy", "server", "browser"],
});
