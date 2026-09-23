import { packageConfig } from "../../vite.package.ts";

export default packageConfig({
  url: import.meta.url,
  name: "@thomasfosterau/effect-web-cloudflare",
  entries: ["index", "hyperdrive", "queues", "cache", "testing"],
});
