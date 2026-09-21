# @kollectyve/chain-descriptors

Generated PAPI descriptors for the Kollectyve runtime — the typed view of every pallet call,
query and event, produced from the chain's own metadata.

**Generated output. Do not edit `dist/` by hand.** It is produced by `papi add` against a node
and copied here by `npm run codegen:substrate` at the workspace root.

## Why it is its own package

`@kollectyve/substrate` depends on these descriptors, but they do not share its release cadence:
they are pinned to a runtime **`specVersion`**, and change when the chain does, not when the SDK
does. A separate package lets a runtime upgrade ship as a descriptors release that consumers can
adopt independently.

It also has to be a real package rather than PAPI's default `file:.papi/descriptors` local
dependency, which npm cannot publish.

## Regenerating after a runtime change

```sh
# against a local dev node, or KOLLECTYVE_WS=wss://… for a deployed one
npm run codegen:substrate
```

That regenerates `.papi/` in `@kollectyve/substrate` and syncs the output here. Then update
`chain-info.json` with the new `specVersion` (and `genesisHash`, if the chain changed) — the sync
warns if the genesis PAPI recorded no longer matches what is committed.

Version in lockstep with the rest of the workspace (`node scripts/version.mjs`). The runtime
coupling is carried by `CHAIN_INFO`, not by the version number.

## Usage

You do not normally import this directly — `@kollectyve/substrate` does it for you:

```ts
import { kollectyve } from "@kollectyve/chain-descriptors";
const api = client.getTypedApi(kollectyve);
```

`polkadot-api` is a peer dependency.

## Knowing what it was built for

```ts
import { CHAIN_INFO } from "@kollectyve/chain-descriptors/chain-info";
// { specName: "kollectyve-runtime", specVersion: 103, genesisHash: "0x934e…", … }
```

`SubstrateClient.ready()` compares this against the connected chain and fails with both versions
named, rather than letting a stale descriptor surface as an opaque decode error later. That is
the whole reason this package exists separately.
