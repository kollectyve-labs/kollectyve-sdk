/** Kollectyve chain constants. Values mirror the runtime (`kollectyve-chain`). */

/** EVM chain id, as returned by `eth_chainId` (0x6d60). Configure MetaMask with this. */
export const KOLLECTYVE_CHAIN_ID = 28000;

/** Substrate SS58 network prefix (runtime `SS58Prefix`). 42 = generic Substrate. */
export const KOLLECTYVE_SS58_PREFIX = 42;

/** Native-token decimals on the Substrate side (UNIT = 1e12). */
export const SUBSTRATE_DECIMALS = 12;

/**
 * Native-token decimals as seen over the EVM/eth-rpc side. `pallet-revive` scales the
 * native balance by `NativeToEthRatio` (1e6) so it presents with 18 decimals, like ETH.
 */
export const EVM_DECIMALS = 18;

/**
 * Human-facing unit: **tRS**, for "Test Renaissance".
 *
 * There is no Kollectyve token. tRS are testnet points standing in for one, with no value and no
 * tradeability. The chain itself declares no symbol — `system_properties` is empty — so this is
 * purely a presentation label, used as the MetaMask currency name and nowhere in consensus.
 */
export const TOKEN_SYMBOL = "tRS";

/** A named set of endpoints for one deployment of the chain. */
export interface NetworkEndpoints {
  /** Substrate JSON-RPC (Polkadot-JS, PAPI). */
  readonly substrateWs: string;
  /**
   * Ethereum JSON-RPC served by the eth-rpc proxy (MetaMask, viem).
   *
   * Optional: a Substrate-only consumer — a product backend enrolling identities, say — can
   * omit it. `KollectyveClient.evm` then throws on first use instead of at construction.
   */
  readonly ethRpc?: string;
}

/** Built-in networks. `custom` is provided at construction time. */
export const NETWORKS = {
  testnet: {
    substrateWs: "wss://rpc-testnet.kollectyve.com",
    ethRpc: "https://rpc-testnet.kollectyve.com/eth",
  },
  local: {
    substrateWs: "ws://127.0.0.1:9944",
    ethRpc: "http://127.0.0.1:8545",
  },
} as const satisfies Record<string, NetworkEndpoints>;

export type NetworkName = keyof typeof NETWORKS;

/** Well-known development accounts (PUBLIC keys — dev/`--dev` chains only, never reuse). */
export const DEV_ACCOUNTS = {
  alith: {
    evm: "0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac",
    privateKey: "0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133",
  },
  baltathar: {
    evm: "0x3Cd0A705a2DC65e5b1E1205896BaA2be8A07c6e0",
    privateKey: "0x8075991ce870b93a8870eca0c0f91913d12f47948ca0fd25b49c6fa7cdbeee8b",
  },
} as const;
