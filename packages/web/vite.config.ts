import { packageConfig } from "../../vite.package.ts";

export default packageConfig({
  url: import.meta.url,
  name: "@thomasfosterau/effect-web",
  entries: ["index", "net", "observability", "negotiate", "service-worker"],
});
