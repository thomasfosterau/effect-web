import { packageConfig } from "../../vite.package.ts";

export default packageConfig({
  url: import.meta.url,
  name: "@thomasfosterau/effect-web-cloudflare",
  // Every suite loads `alchemy/Cloudflare` (effect-web#31): see `alchemyTests`.
  alchemyTests: "all",
  entries: ["index", "hyperdrive", "queues", "cache", "testing", "robots"],
});
