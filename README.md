# Kollectyve SDK

TypeScript SDK for the [Kollectyve chain](https://github.com/kollectyve-labs/kollectyve-chain) — one toolkit for **both**
sides of the chain:

- **Substrate** — the custom pallets (identity, policy, kumulus), built on
  [PAPI (polkadot-api)](https://papi.how).
- **EVM** — `pallet-revive` contracts via the `eth-rpc` proxy, built on
  [viem](https://viem.sh).
- **React** — a provider, hooks and wallet connection for browser dApps.

The two worlds share **one address model** (`pallet-revive`'s `AccountId32 ⇄ H160` mapping),
so an EVM address and its Substrate identity are one function call apart.

## Packages

| Package | What it is | Built on |
|---|---|---|
| [`@kollectyve/core`](packages/core) | Chain constants, the **address bridge**, SS58, shared types/errors. No chain deps. | `@noble/hashes`, `@scure/base` |
| [`@kollectyve/substrate`](packages/substrate) | Client + one façade per pallet (`identity`, `policy`, `kumulus`). | PAPI |
| [`@kollectyve/evm`](packages/evm) | viem client + chain def + typed contract wrappers. | viem |
| [`@kollectyve/sdk`](packages/sdk) | **Umbrella** — the unified `KollectyveClient` over both. | ↑ |
| [`@kollectyve/react`](packages/react) | `KollectyveProvider`, hooks, wallet connection. Bindings only — every hook wraps a framework-free function from the packages above. | React |
| [`@kollectyve/chain-descriptors`](packages/descriptors) | Generated PAPI descriptors — the typed view of the runtime. Pinned to a `specVersion`. | `papi add` |

Most apps depend on **`@kollectyve/sdk`** (or `@kollectyve/react` for a UI). The sub-packages
are there for tree-shaking and for consumers that only need one side.

**Not using React?** Nothing is React-only, and nothing assumes a browser. `@kollectyve/sdk`
is the whole SDK — signers, wallet connection, transaction progress and event subscriptions are
plain functions and callbacks. `@kollectyve/react` adds state plumbing over them, and a binding
layer for another framework would be about 40 lines with no new behaviour.

## Who it's for

What changes between consumers is **the signer**, not the API — the same call is made by a
backend signing with a Vault key, by a user signing in a wallet extension, and by a service
signing with its own key.

| You are… | You sign with | Start at |
|---|---|---|
| A **product backend** enrolling custodial users | a key in Vault/KMS | `signerFromKeyProvider`, `identity.enroll` |
| An **external dApp developer** on `pallet-revive` | MetaMask | `connectEvmWallet`, `kollectyveChain()` |
| A **service or protocol integrator** | your own key, server-side | `signerFromKeypair` |
| A **user with their own key** (or a dApp acting for one) | a wallet extension | `connectSubstrateWallet` |
| **Developing locally** | a `--dev` chain account | `devSigner("Alice")` |

Where a chain's genesis never wired the privileged key, `EnsureRoot` is the only arm — pass
`{ sudo: true }` on the write and the SDK wraps it in `Sudo.sudo` and throws if the *inner* call
failed (a sudo extrinsic succeeds at the outer level regardless).

Writes are origin-gated: `register_identity` needs the **enrollment** origin and everything in
`policy` plus `set_tier` needs the **compliance** origin, so those are backend/operator calls.
`rotate_controller` and `register_provider` are what an ordinary user signs. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full actor table.

## Install

```sh
# prerelease while the testnet settles — pin exactly; the API moves
npm i @kollectyve/sdk@0.1.0-alpha.2
# for React apps:
npm i @kollectyve/react@0.1.0-alpha.2 react
```

## The testnet

| Setting | Value |
|---|---|
| Substrate RPC | `wss://rpc-testnet.kollectyve.com` |
| EVM RPC | `https://rpc-testnet.kollectyve.com/eth` |
| Chain ID (EVM) | `28000` |
| Token | `tRS`, 12 decimals on Substrate / 18 on the EVM |
| Block time | ~6 seconds |
| Faucet | [faucet.kollectyve.com](https://faucet.kollectyve.com) — 10 tRS per address / 24h |

These are the defaults, so `network: "testnet"` needs no endpoints. State persists: it is a real
chain spec, not `--dev`.

One thing that surprises everyone once — **`eth_getBalance` reports less than the Substrate
side**, by exactly `0.001 tRS`. That is the existential deposit: it keeps the account alive and
cannot be spent, so the EVM reports spendable balance while `System.Account` reports free
balance. Both are correct; reconciling them means adding the deposit back, not raising an alarm.

Deploying contracts rather than using the SDK? Start with the
[Hardhat example](https://github.com/kollectyve-labs/kollectyve-hardhat-example) or the
[guide (French)](https://docs.kollectyve.com/evm/deployer-un-contrat).

## Quickstart

### Unified client

```ts
import { KollectyveClient, DEV_ACCOUNTS } from "@kollectyve/sdk";

// `connect` waits for the node and throws a clear error if it isn't there. `new
// KollectyveClient(...)` also works and connects lazily — but then an unreachable endpoint
// shows up as reads that never settle, because the websocket retries forever.
const k = await KollectyveClient.connect({ network: "local" }); // or "testnet", or explicit endpoints

// EVM side (read)
const head = await k.evm.public.getBlockNumber();
const bal = await k.evm.public.getBalance({ address: DEV_ACCOUNTS.alith.evm });

// Substrate side (read)
const tier = await k.substrate.identity.tierOf(1n);

// the shared address bridge
const ss58 = k.addresses.evmToSs58(DEV_ACCOUNTS.alith.evm);
const h160 = k.addresses.ss58ToEvm(ss58);
```

### EVM with a signer (deploy / write)

```ts
import { KollectyveClient, getStorageContract, DEV_ACCOUNTS } from "@kollectyve/sdk";

const k = new KollectyveClient({
  network: "local",
  evmSigner: { privateKey: DEV_ACCOUNTS.alith.privateKey }, // or { eip1193: window.ethereum }
});

const storage = getStorageContract(k.evm, "0xYourDeployedAddress");
const value = await storage.read.retrieve();
const hash = await storage.write.store([42n]);
```

### Backend: enrol a custodial user

The flow a product backend runs on signup. The key never enters this process — Vault signs.

```ts
import { KollectyveClient, signerFromKeyProvider } from "@kollectyve/sdk";

const registrar = signerFromKeyProvider(
  await vault.publicKey("registrar"),
  (payload) => vault.sign("registrar", payload),
  "Ed25519",                              // must match how the key was generated
);
// Substrate-only: omit `ethRpc` and the EVM half is never built.
const k = await KollectyveClient.connect({
  network: { substrateWs: "ws://127.0.0.1:9944" },
  substrateSigner: registrar,
});

// Idempotent: a retry after a timeout returns the same identity instead of minting another.
const { id, created } = await k.substrate.identity.enroll(custodialAddress, authUserId);
```

### A user signing for themselves

```ts
import { connectSubstrateWallet } from "@kollectyve/sdk";

const { accounts } = await connectSubstrateWallet("My dApp");
const signer = accounts[0].polkadotSigner;

await k.substrate.identity.rotateController(id, newAddress, signer);       // self-custody
await k.substrate.kumulus.registerProvider({ cpuCores: 8, memoryMb: 16384, storageGb: 512, region: 686 }, signer);
```

On a `--dev` chain both privileged origins are Alice — `devSigner("Alice")`.

### React

```tsx
import { KollectyveProvider, useEvmBalance, useConnectWallet } from "@kollectyve/react";

function App() {
  return (
    <KollectyveProvider network="testnet">
      <Wallet />
    </KollectyveProvider>
  );
}

function Wallet() {
  const { wallet, connect } = useConnectWallet();
  const { data } = useEvmBalance(wallet?.address);
  return wallet
    ? <p>{wallet.address}: {data?.formatted} tRS</p>
    : <button onClick={connect}>Connect MetaMask</button>;
}
```

React also has `useSubstrateWallet` (extension accounts + signers), `useTx` (one extrinsic,
with live phase), and `useChainEvents` (a subscription bound to the component's lifetime):

```tsx
const { submit, progress, pending } = useTx(account.polkadotSigner);
await submit((k, o) => k.substrate.identity.rotateController(id, next, o));

const { events } = useChainEvents((k, on) => k.substrate.identity.onTierSet(on));
```

## The address bridge (why this SDK exists)

`pallet-revive` stores one balance ledger but addresses accounts two ways. `@kollectyve/core`
reproduces the pallet's *stateless* mapping exactly (verified against genesis + canonical
vectors in `packages/core/test`):

```ts
import { evmToAccountId32, accountId32ToEvm, evmToSs58, ss58ToEvm } from "@kollectyve/core";

evmToAccountId32("0xf24F…cac"); // → 0xf24f…cac + 0xEE×12  (the "fallback" AccountId32)
accountId32ToEvm(pubkeyOrSs58);  // eth-derived → strip 0xEE; native → keccak256(pubkey)[12..]
```

> **Caveat:** `evmToAccountId32` is exact for secp256k1/EVM-origin accounts (MetaMask,
> contracts). A *Substrate* account that explicitly called `revive.map()` resolves through
> on-chain `OriginalAccount` storage instead — use a Substrate query for that case.

## Substrate types

The `@kollectyve/substrate` façades run on PAPI's **typed** API, built from descriptors
generated out of the chain's own metadata — every pallet call, query and event they touch is
checked against the runtime at compile time.

`.papi/polkadot-api.json` and `.papi/metadata/kollectyve.scale` are committed; the descriptors
themselves are regenerated from that metadata by `papi` on every `npm install`, so a fresh
clone builds with no node running. Regenerate against a live chain when the runtime's
`specVersion` changes in a way that affects the pallet API:

```sh
npm run codegen:substrate                                  # against ws://127.0.0.1:9944
KOLLECTYVE_WS=wss://rpc-testnet.kollectyve.com npm run codegen:substrate
```

`SubstrateClient.unsafeApi` is the untyped escape hatch for anything the descriptors miss.

## Following a transaction

Pass `onProgress` instead of a bare signer and the extrinsic is submitted *watched* — every
transition is reported before the promise settles:

```ts
await k.substrate.identity.setTier(id, "Verified", {
  signer,
  onProgress: (p) => console.log(p.phase, p.block?.number),
  // signed → broadcasted → inBestBlock → finalized
});
```

`inBestBlock` is the first phase that knows the outcome (`ok`, and `dispatchError` on failure),
but a best block can still be reorged away; `finalized` cannot. A call the runtime **rejected**
still resolves — with `ok: false` and a `dispatchError` — so check `ok` rather than assuming a
result means success. Only a transaction that never made it (invalid, dropped, disconnected)
rejects, with a `TransactionError`.

## Chain events

Each pallet façade exposes its events as `on<EventName>`, decoded into the SDK's own types and
delivered from **finalized** blocks. Each returns an unsubscribe:

```ts
const stop = k.substrate.identity.onIdentityRegistered(({ payload, block }) => {
  console.log(`identity #${payload.id} → ${payload.controller} in #${block.number}`);
});

k.substrate.policy.onAssetFrozen(({ payload }) => halt(payload.asset), {
  filter: (e) => e.frozen,      // evaluated before decoding
  onError: (e) => report(e),    // otherwise subscription errors are swallowed
});
```

Available: `identity.onIdentityRegistered` / `onTierSet` / `onControllerRotated`,
`policy.onClaimSet` / `onClaimRevoked` / `onAssetPolicySet` / `onAssetFrozen`,
`kumulus.onProviderRegistered` / `onProviderUpdated`.

## Connection state

The websocket provider reconnects on its own and never gives up, so a dApp whose node goes
away otherwise just hangs on its next read. Pass `onConnectionStatus` to see it:

```ts
import { WsEvent } from "@kollectyve/sdk";

const k = new KollectyveClient({
  network: "local",
  onConnectionStatus: (s) => setOffline(s.type !== WsEvent.CONNECTED),
});

await k.ready();              // throws a ConnectionError naming the endpoint
k.substrate.client.connected; // current state, without awaiting
```

Writes call `ready()` for you, so an extrinsic submitted against a dead endpoint fails instead
of sitting in limbo. Reads stay lazy — await `ready()` once at start-up, or use
`KollectyveClient.connect()`.

## Development

```sh
npm install        # also regenerates the PAPI descriptors from the committed metadata
npm run build      # builds packages in dependency order (core → evm/substrate → sdk → react)
npm test           # unit tests (core: address-bridge vectors; substrate: SCALE codec)
npm run typecheck
npm run smoke      # end-to-end against a running dev chain — see below
```

`node scripts/faucet.mjs <address> [amount] [network]` funds either side of a chain — an `0x`
address over the EVM, an SS58 address over Substrate, both crediting the same account. Set
`KOLLECTYVE_FAUCET_SEED` / `KOLLECTYVE_FAUCET_EVM_KEY` or it falls back to the public dev keys.
For the public testnet, use the web faucet at
[faucet.kollectyve.com](https://faucet.kollectyve.com) instead — 10 tRS per address every 24h.

`npm run smoke` exercises every façade call and both sides of the address bridge against a
local dev chain (`dev-chain.sh` in the
[chain repo](https://github.com/kollectyve-labs/kollectyve-chain)), asserting each extrinsic actually dispatched. It is the only check that
proves the SDK's encodings are what the runtime accepts; unit tests and the compiler cannot.
It exits non-zero with a clear message if no node is listening.

Node ≥ 20. ESM-only. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for design rationale
(PAPI vs polkadot.js, viem vs ethers, versioning policy).

## Versioning and publishing

All six packages share one version and ship together, in dependency order — `core` →
`chain-descriptors` → `evm` → `substrate` → `sdk` → `react`.

```sh
node scripts/version.mjs prerelease   # 0.1.0-alpha.2 → 0.1.0-alpha.3 (all six, in lockstep)
npm install                           # refresh the lockfile
npm run publish:dry                   # builds, tests, packs every tarball; sends nothing
npm login
npm run publish:all                   # moves both `latest` and `next`
```

While the testnet is still moving, releases are prereleases — `0.1.0-alpha.N`. Each one moves
both tags, so `@next` and a bare install both get the newest build. Every published version also
carries an `npm deprecate` notice naming the runtime `specVersion` it targets, which is what
actually warns someone off; a dist-tag cannot, since npm assigns `latest` on a package's first
publish no matter what `--tag` says.

Publishing needs a granular access token with 2FA bypass in `~/.npmrc` — npm requires it even
when the account has 2FA disabled.

**You do not need to publish to iterate.** Consumers resolve the SDK through a workspace link
during development (see the Kumulus backend's `import_map.local.json`); cut a version when
something needs to *deploy*, not when something changes.

Stay on `0.x` until the API is frozen — semver already reads that as "anything may break". A
published version is permanent, so never reuse one. Full policy in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#versioning-policy).

### Runtime compatibility

The descriptors are only valid for the runtime they were generated from, so the SDK checks:

```ts
await k.ready();
// ConnectionError: ws://…: runtime specVersion 104 but the descriptors were generated
// from 103 — regenerate with `npm run codegen:substrate`

k.substrate.client.descriptorChain;   // { specName, specVersion, genesisHash, … }
```

It also catches a genesis mismatch — a different chain, or a dev chain that was purged. Pass
`onChainMismatch: "warn" | "ignore"` to loosen it, deliberately.

## Status

Pre-1.0. Published on npm as `0.1.0-alpha.2` — all six packages, on both the `latest` and
`next` tags.

Implemented and tested: `@kollectyve/core` (address bridge, SS58, constants, commitments), and
the Substrate façades, which cover every call and storage item of the three pallets on the typed
PAPI API, with SCALE shapes pinned by `packages/substrate/test/codec.test.ts`. The EVM and React
layers are exercised by type-checking. `npm run smoke` covers the whole surface end-to-end
against a dev chain.

Every client defaults to `network: "testnet"`, which is live — see
[the network table](#the-testnet). Pass `network: "local"` to work against a dev chain instead.

The public API may change before 1.0, so **pin exact versions**. A published version is
permanent and prereleases move fast.
