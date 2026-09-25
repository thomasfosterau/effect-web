# @thomasfosterau/effect-web

Framework-neutral web request/response utilities on `effect/unstable/http`, extracted from the `thomasfosterau/website`, `thomasfosterau/gardeneria` and `thomasfosterau/preferenceflow` applications.

**Status:** scaffold. The package publishes an empty placeholder surface until [effect-web#2](https://github.com/thomasfosterau/effect-web/issues/2) lands the utilities.

## Install

```sh
pnpm add @thomasfosterau/effect-web effect
```

`effect` (>= 4.0.0-rc.112) is a peer dependency.

## API

### `packageName`

The package name, as a consumer imports it.

```ts
import { packageName } from "@thomasfosterau/effect-web";

packageName; // "@thomasfosterau/effect-web"
```
