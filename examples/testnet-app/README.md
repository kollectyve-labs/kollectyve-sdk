# Kollectyve testnet demo

A small React dApp that talks to **both sides** of the Kollectyve chain through
`@kollectyve/sdk` — the Substrate pallets and the EVM side of `pallet-revive` — against the
public testnet.

```sh
npm install
npm run dev      # http://localhost:5173
```

It installs `@kollectyve/sdk` and `@kollectyve/react` **from npm**, not from this workspace
(it is deliberately excluded from the root `workspaces`), so it exercises the published
packages exactly as a third-party app would.

## What it shows

| Panel | Substrate | EVM |
|---|---|---|
| **Substrate** | live finalized head, `NextIdentityId`, the runtime version the descriptors target; wallet-extension accounts; a `balances.transfer_keep_alive` with **live transaction phases**; a feed of finalized `IdentityRegistered` events | |
| **EVM** | | MetaMask connect (adds chain id 28000 if missing), native balance, and deploy + call a Solidity `Storage` contract through `eth-rpc` |
| **Address bridge** | the stateless `H160 ⇄ AccountId32` mapping in both directions — the primitive that makes this one chain rather than two | |

The network switcher flips between `testnet` and `local`; `local` expects
`kollectyve-chain/scripts/dev-chain.sh` on `:9944` and `:8545`.

## What you need to interact

Reads work with no wallet at all.

- **Substrate writes** — a wallet extension (Polkadot-JS, Talisman, SubWallet) with a funded
  account. The transfer is used precisely because it is *permissionless*: `register_identity`
  and everything in `policy` are origin-gated to the registrar and compliance keys, so they are
  not things a demo wallet can do.
- **EVM writes** — MetaMask with some tRS on chain id 28000.

## Notes

`onChainMismatch="warn"` is set on the provider: if the testnet's runtime moves ahead of the
descriptors this app was built against, you get a console warning rather than a hard failure.
For a backend you would leave it at the default (`"throw"`).
