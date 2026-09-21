# Kollectyve SDK — Architecture & Design

## Who this is for

The SDK's first framing was "frontend-dApp first", written when the only planned consumers were
Kollectyve's own products. Those products follow the account-abstraction rule in the chain's
[`INTEGRATION-MAP.md`](../../kollectyve-chain/docs/account-abstraction/INTEGRATION-MAP.md):
*only backends touch keys and the chain.* Read narrowly that rule seems to say frontends never
use an SDK at all — but it is scoped to **custodial** users, whose keys Kollectyve holds. It
says nothing about actors who hold their own keys, and the testnet exists precisely so those
actors can build.

So the SDK serves an actor set, not a framework:

| Actor | Holds their own key? | How they reach the chain | SDK surface |
|---|---|---|---|
| **Custodial end user** — signs up with an email, never sees a wallet | No; the product backend holds it in Vault/KMS | Frontend → HTTPS → product backend → chain | `signerFromKeyProvider`, `identity.enroll` |
| **Product backend** — Kumulus, Kallama, AAkili | Holds users' custodial keys and its own | Directly, server-side | Whole Substrate surface; enrollment origin |
| **Graduated user** — took custody of their own key | Yes | Their wallet extension, directly | `connectSubstrateWallet`, `rotateController` |
| **External dApp developer** | Yes | MetaMask + `eth-rpc`, or a wallet extension | `connectEvmWallet`, `kollectyveChain()`, contract wrappers |
| **External service / protocol integrator** | Yes | Server-side, own signer | `signerFromKeypair`, `signerFromKeyProvider` |
| **Machine actor** — a Kumulus agent | Yes, a local low-privilege key | v1: through its backend. Later: directly, once the runtime can scope an agent key | `signerFromKeypair`; scoped rights are a **runtime** gap |
| **Registrar / compliance operator** | Hot key / multisig | Server-side, privileged origins | `identity.enroll`, `setTier`, `policy.*`; multisig is a **gap** |
| **Node operator / validator** | — | Not an SDK consumer | — |

Two things follow, and they drive the design:

1. **The signer is the axis, not the framework.** The same `registerProvider` call is made by a
   backend signing with a Vault key, by a graduated user signing in MetaMask, and by an agent
   signing with its own key. Every façade write therefore takes a `PolkadotSigner` from any
   source, and `signers.ts` covers each way of getting one.
2. **Browser and server are equal citizens.** Endpoints, the websocket provider and the typed
   API work in both; nothing in the core packages assumes a `window`.

## Goals

1. **One SDK, two worlds.** The chain is simultaneously a Substrate chain and an EVM chain
   (via `pallet-revive`). The SDK must make both first-class and let them interoperate —
   above all through the shared account model.
2. **Every actor above, on one client.** What changes between them is the signer and which
   origin will accept the call, not the API.
3. **Public package.** Third parties build on it → stable, documented, versioned API; types
   generated from the chain rather than hand-maintained.

## Technology choices

### Substrate: PAPI (polkadot-api), not polkadot.js

| Factor | Decision |
|---|---|
| Direction | PAPI is the ecosystem's actively-developed client; polkadot.js is in maintenance mode. |
| Types | PAPI **generates typed descriptors from chain metadata** — our custom pallets get typed calls/queries/events for free, and stay correct across `specVersion` bumps. |
| Bundle | PAPI is light and tree-shakeable; polkadot.js is heavy — a real cost for a browser SDK. |
| Light client | PAPI is smoldot-first, a future option for trustless in-browser reads. |
| Cost | Smaller community / fewer examples than polkadot.js — accepted. |

The `@kollectyve/substrate` client wraps PAPI's **typed** API. The chain's metadata is committed
(`.papi/metadata/kollectyve.scale`) and `papi` regenerates the descriptors on `postinstall`, so
a clone builds without a running node while every pallet call stays checked against the runtime.
`SubstrateClient.unsafeApi` remains as an escape hatch.

### EVM: viem, not ethers

TypeScript-first, ABI-typed via `abitype`, tree-shakeable, the modern default. The chain's
`eth-rpc` proxy speaks standard Ethereum JSON-RPC, so viem needs only a chain definition
(id 28000) and the proxy URL. ethers v6 would also work; viem wins on types + bundle.

## Package boundaries

```
@kollectyve/core          no chain deps — pure functions + constants
   ▲          ▲
   │          │
@kollectyve/substrate   @kollectyve/evm
   ▲          ▲
   └────┬─────┘
   @kollectyve/sdk        unified KollectyveClient
        ▲
   @kollectyve/react      provider + hooks (peer: react)
```

- **`core` has no chain/runtime dependency** on purpose — the address bridge and SS58 are
  pure, testable functions usable even outside this SDK. It depends only on audited crypto
  primitives (`@noble/hashes`, `@scure/base`).
- **`substrate` and `evm` are independent** — a consumer who only needs one side pays for
  only that side.
- **`sdk`** composes them into `KollectyveClient` with one config object.
- **`react`** is separate so non-React consumers never pull it in, and is held to one rule:
  **no logic lives only in the React package.** Every hook is a binding over a function that
  already exists framework-free — `useConnectWallet` over `connectEvmWallet`,
  `useSubstrateWallet` over `connectSubstrateWallet`, `useTx` over `submitTx`,
  `useChainEvents` over `watchEvent`. What the hooks add is React state, nothing more.

  That rule is what keeps the SDK framework-neutral in practice rather than in principle: a
  Vue, Svelte or Solid consumer calls the same functions and writes ~40 lines of their own
  state plumbing, and a future `@kollectyve/vue` would be a port of bindings, not a port of
  behaviour. It is also the thing to check in review — a hook that starts doing real work is
  a bug, and the fix is to push it down into `core`, `evm` or `substrate`.

## The address bridge

The single most important primitive. `pallet-revive`'s `AccountId32Mapper` (polkadot-sdk
stable2606) defines:

- **H160 → AccountId32** (fallback): `address(20) ++ 0xEE × 12`. Exact for secp256k1/EVM
  accounts; a Substrate account that called `revive.map()` resolves via on-chain storage.
- **AccountId32 → H160**: eth-derived (trailing `0xEE×12`) → strip suffix; native key →
  `keccak256(pubkey)[12..]` (hash, not truncate).

`@kollectyve/core` reproduces this statelessly and tests it against the genesis-funded alith
vector and the canonical Alice SS58 address, so byte-level behavior matches the chain.

## Versioning policy

**Two clocks, deliberately separated.** The SDK's API changes when we change it; the runtime's
API changes when the chain is upgraded. Conflating them is what makes an SDK painful to release,
so the generated descriptors are their own package.

### One version across the workspace

All six packages ship together and share a version (`node scripts/version.mjs`, which rewrites
every `version` and every internal `@kollectyve/*` range in lockstep). Independent versioning
would buy nothing and cost a dependency matrix to reason about at every release.

Note the script uses **exact** internal ranges for a prerelease: `^0.1.0-alpha.1` does *not*
match `0.1.0-alpha.2`, so a caret range across a prerelease bump silently resolves siblings to a
stale version.

### 0.x while the testnet moves

Stay on `0.x` until the testnet API is frozen. Semver already reads `0.x` as "anything may
break", so a breaking change needs no deliberation — bump the minor, patch for everything else.
Going to 1.0 is a promise about stability; make it when the chain can keep it.

### Prereleases, and the tags

Development releases go out as `0.1.0-alpha.N`, and each one moves **both** `latest` and `next`.

The original plan was to withhold `latest` so a bare `npm i @kollectyve/sdk` would fail. That is
not achievable: **npm assigns `latest` on a package's first publish regardless of `--tag`**,
because it needs a default, so `0.1.0-alpha.1` claimed it anyway and npm does not allow removing
the tag. Given that, leaving `latest` frozen on the first alpha is the worst option — a bare
install would fetch the *stalest* build — so releases move it forward.

Keeping third parties off a moving runtime is done where it actually reads: the version string
says `-alpha`, every published version carries an `npm deprecate` notice naming the runtime
`specVersion` it targets, and the README leads with the status. A dist-tag was never the right
instrument.

**Publish frequency tracks deploys, not commits.** Day to day the consumers resolve the SDK
through a workspace link (see the Kumulus backend's `import_map.local.json`); a version is cut
only when something needs to deploy.

A published version is permanent: `npm unpublish` works only within 72 hours and only if nothing
depends on it. Versions are free — never reuse one; `npm deprecate` retires a bad one.

Publishing also requires 2FA or a granular access token with 2FA bypass, regardless of what the
account's own 2FA setting says — a token in `~/.npmrc` is the right fit, since a release is six
sequential publishes and an OTP can expire partway through and leave a half-published set.

### Descriptors track the runtime

`@kollectyve/chain-descriptors` rides the same version number for simplicity, but it is only
valid for the runtime it was generated from. That coupling is made explicit rather than encoded
in the version: the package exports `CHAIN_INFO` (`specName`, `specVersion`, `genesisHash`), and
`SubstrateClient.ready()` compares it against the connected chain, failing with one sentence
naming both versions instead of an opaque decode error several calls later. Consumers who need
to run against a mismatched chain can downgrade that to a warning with `onChainMismatch`.

Regenerate and re-release after any runtime upgrade that touches the pallet API:
`npm run codegen:substrate`, then update `packages/descriptors/chain-info.json`.

## What lives where — extension points

- **New pallet?** Add a façade in `packages/substrate/src/pallets/`, register it on
  `KollectyveSubstrate`. Names come from the runtime metadata.
- **New contract?** Add its ABI + a `getXContract` wrapper in `packages/evm/src/contracts/`
  (pattern: `storage.ts`). viem types it from the `as const` ABI, no codegen.
- **New hook?** Add to `packages/react/src/hooks.ts` using `useKollectyve()`.

## Known gaps (pre-1.0)

- `packages/substrate/src/codec.ts` is the single boundary between the SDK's camelCase types
  and the runtime's SCALE shapes (snake_case fields, `{ type, value }` enums). It is
  hand-written against the generated types rather than derived from them.
- Not published to npm — consumers build the workspace and link.
- No batching/multicall helpers.
- Event subscriptions and tx progress are delivered by callback, wrapping PAPI's rxjs
  Observables behind a structural `Subscribable` type so rxjs never reaches the public API or a
  consumer's dependency list. That also means no operator composition — a consumer who wants
  `debounce` or `combineLatest` has to reach for `client.getTypedApi()` directly.
- Events are watched on **finalized** blocks only. A UI that wants optimistic display should
  drive it from a transaction's `inBestBlock` phase instead.
- The descriptors pin a `specVersion`; a runtime upgrade that changes the pallet API needs
  `npm run codegen:substrate` against a node and a re-commit of the metadata.
- `npm run smoke` is a script, not a CI job — nothing runs it automatically, and it needs a
  dev chain.
- **No multisig helper**, though `pallet_multisig` sits at runtime index 10 and the compliance
  origin is specified as a 2-of-3 multisig. A compliance operator today has to assemble
  `Multisig.as_multi` calls by hand through `unsafeApi`.
- **No agent/scoped-key support**, because the runtime has none: it cannot yet distinguish an
  agent key from a controller key on the same identity, which is why agents route through their
  backend in v1. This is a chain gap the SDK cannot paper over.
- **No funding *policy* helper.** `balances.transferKeepAlive` / `freeBalance` now cover the
  mechanics, but the cap-and-drain-alert logic (`FundingGuard`, decision D42) still lives in the
  Kumulus backend, and a second product backend would write it again.
- **No custodial key derivation.** `signerFromKeyProvider` takes a public key and a sign
  callback, but deriving the per-user ed25519 key (`blake2-256(masterSecret || ":" || userId)`,
  or a Vault Transit key per user) lives in the backend. That derivation is a cross-product
  convention like the commitment, and belongs beside it.
- **No sudo-wrapped enrollment.** The runtime's `EnrollmentOrigin` is `Root OR the enrollment
  key`; the SDK only signs directly, so it cannot enrol on a chain whose `enrollmentKey` is
  unset (where root/sudo is the only arm). The Kumulus backend supports both modes.
- **Custodial key *derivation* is still the backend's.** `signerFromKeyProvider` takes a public
  key and a sign callback, but deriving the per-user ed25519 key from a master secret (or a Vault
  Transit key per user) lives in Kumulus. Like the commitment, it is a cross-product convention
  and belongs beside it — the move needs address vectors pinned from the deployed code first.
- **The Vault signing path is verified only in shape.** `chain:verify` in the Kumulus backend
  exercises the ed25519 custodial signer against a live chain, which proves PAPI's payload
  hashing and `MultiSignature` tagging; it has not been run against a real Vault Transit mount.
