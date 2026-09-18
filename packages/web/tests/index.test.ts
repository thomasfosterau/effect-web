import { describe, expect, it } from "vite-plus/test";
import { packageName } from "../src/index.ts";

describe("placeholder", () => {
  it("names the package", () => {
    expect(packageName).toBe("@thomasfosterau/effect-web");
  });
});
