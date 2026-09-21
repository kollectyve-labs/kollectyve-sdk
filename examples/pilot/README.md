# Kollectyve Playground (pilot dApp)

A small React app that exercises **both** sides of the chain through `@kollectyve/sdk`, to
prove the SDK end-to-end against a locally-running node.

Three panels:

1. **EVM (pallet-revive)** — connect MetaMask, show the tRS balance, **deploy** the sample
   `Storage` contract (bytecode embedded), then `store` / `increment` / `retrieve`.
2. **Substrate (pallet-kollectyve-id)** — live finalized block, query an identity's tier &
   controller, and **register an identity** signed by the baked-in Alice dev key.
3. **Bridge** — take an EVM address, derive its Substrate `AccountId32` / SS58, and read the
   *same account's* balance from both sides (18-decimal EVM vs 12-decimal Substrate).

## Run it

**1. Start the chain** (in `kollectyve-chain`):

```sh
cd ../../kollectyve-chain
./scripts/dev-chain.sh          # node :9944, eth-rpc :8545
```

**2. Start the dApp** (from `kollectyve-sdk`, so workspace packages are linked):

```sh
cd kollectyve-sdk
npm install                     # once, from the workspace root
npm run dev -w @kollectyve/pilot
```

Open http://localhost:5173. Leave the network selector on **local**.

**3. MetaMask** — add the network once: RPC `http://127.0.0.1:8545`, chain ID `28000`,
symbol `tRS`. Import a funded dev key to see a balance and deploy:

```
alith  0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133
```

## What proves what

| Action | Proves |
|---|---|
| Deploy + store | plain solc bytecode runs on pallet-revive's REVM backend; EVM writes land |
| Register identity | a real pallet extrinsic, signed via PAPI, is accepted (Alice = enrollment key on `--dev`) |
| Bridge an address | the `AccountId32 ⇄ H160` mapping is correct — one ledger entry, two views |

## Notes

- Substrate reads/writes use PAPI's **untyped** API (as the SDK ships). If you run
  `npm run codegen:substrate` and switch the client to `getTypedApi`, the same calls become
  fully type-checked — no changes needed here.
- The Alice seed and the alith key are **public dev keys**. Never use them anywhere with value.
- `register` and `store` need a few seconds (6s block time) to finalize.
