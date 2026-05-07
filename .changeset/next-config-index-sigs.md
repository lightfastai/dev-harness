---
"@lightfastai/dev-proxy": patch
"@lightfastai/dev-cli": patch
"@lightfastai/dev-core": patch
"@lightfastai/dev-services": patch
---

fix(dev-proxy): drop incompatible `[key: string]: unknown` index signatures from `NextConfigWithPortlessProxy.experimental`

The 0.3.0 release widened `NextConfigWithPortlessProxy.experimental` (and `experimental.serverActions`) with `[key: string]: unknown` index signatures. Next's `ExperimentalConfig` does not declare an index signature, so passing a real `NextConfig` through `withPortlessProxy` failed with `error TS2345: Index signature for type 'string' is missing in type 'ExperimentalConfig'`. Removing the index signatures restores compatibility with downstream Next 16 configs.
