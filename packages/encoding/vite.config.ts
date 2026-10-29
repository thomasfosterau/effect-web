import { packageConfig } from "../../vite.package.ts";

export default packageConfig({
  url: import.meta.url,
  name: "@thomasfosterau/effect-encoding",
  entries: ["index", "japanese", "gb18030", "big5", "euc-kr"],
});
