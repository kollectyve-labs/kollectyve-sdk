import {
  ConnectionError,
  NETWORKS,
  type NetworkEndpoints,
  type NetworkName,
  accountId32ToEvm,
  evmToAccountId32,
  evmToSs58,
  ss58ToEvm,
} from "@kollectyve/core";
import { KollectyveSubstrate, type SubstrateClientOptions } from "@kollectyve/substrate";
import { createEvmClient, type EvmClient, type EvmClientOptions } from "@kollectyve/evm";
import type { PolkadotSigner } from "polkadot-api";

export interface KollectyveClientOptions {
  /** A built-in network name, or explicit endpoints. Defaults to `"testnet"`. */
  network?: NetworkName | NetworkEndpoints;
  /** Substrate extrinsic signer (wallet extension or keypair). */
  substrateSigner?: PolkadotSigner;
  /** EVM signer. See {@link EvmClientOptions.signer}. */
  evmSigner?: EvmClientOptions["signer"];
  /** Notified on every Substrate websocket transition. See {@link SubstrateClientOptions}. */
  onConnectionStatus?: SubstrateClientOptions["onConnectionStatus"];
  /** How long {@link KollectyveClient.ready} waits for the node. Default 20s. */
  connectionTimeout?: number;
  /**
   * What to do when the connected chain's runtime does not match the descriptors this SDK was
   * built against. Default `"throw"`. See {@link SubstrateClientOptions.onChainMismatch}.
   */
  onChainMismatch?: SubstrateClientOptions["onChainMismatch"];
}

function resolveEndpoints(network: KollectyveClientOptions["network"]): NetworkEndpoints {
  if (!network) return NETWORKS.testnet;
  if (typeof network === "string") return NETWORKS[network];
  return network;
}

/**
 * The one entry point. Exposes the two worlds as sub-clients over a single configuration:
 *
 * ```ts
 * const k = new KollectyveClient({ network: "testnet" });
 * await k.substrate.identity.tierOf(1n);        // pallet query
 * await k.evm.public.getBlockNumber();          // EVM read
 * k.addresses.evmToSs58("0xf24F…cac");          // shared address bridge
 * ```
 */
export class KollectyveClient {
  readonly endpoints: NetworkEndpoints;
  readonly substrate: KollectyveSubstrate;
  #evm: EvmClient | undefined;
  #evmSigner: EvmClientOptions["signer"];

  /** The shared address bridge (see `@kollectyve/core`). */
  readonly addresses = { evmToAccountId32, accountId32ToEvm, evmToSs58, ss58ToEvm };

  constructor(options: KollectyveClientOptions = {}) {
    this.endpoints = resolveEndpoints(options.network);
    this.substrate = new KollectyveSubstrate({
      substrateWs: this.endpoints.substrateWs,
      signer: options.substrateSigner,
      onConnectionStatus: options.onConnectionStatus,
      connectionTimeout: options.connectionTimeout,
      onChainMismatch: options.onChainMismatch,
    });
    this.#evmSigner = options.evmSigner;
  }

  /**
   * The EVM half, built on first use.
   *
   * Lazy on purpose: the SDK's primary consumers are Substrate-only — a product backend
   * enrolling identities never touches `pallet-revive` — and eagerly constructing a viem
   * client meant they had to invent an `ethRpc` value and pay for viem to be loaded. Throws
   * only if the endpoints carry no `ethRpc`.
   */
  get evm(): EvmClient {
    if (!this.#evm) {
      const ethRpc = this.endpoints.ethRpc;
      if (!ethRpc) {
        throw new ConnectionError(
          "this client has no ethRpc endpoint — pass one in `network` to use the EVM side",
        );
      }
      this.#evm = createEvmClient({ ethRpc, signer: this.#evmSigner });
    }
    return this.#evm;
  }

  /**
   * Build a client and wait for the chain to answer, failing with a clear error if it does
   * not. Prefer this over `new KollectyveClient()` at start-up: the websocket provider retries
   * forever, so a bad endpoint otherwise shows up as reads that hang rather than as an error.
   *
   * ```ts
   * const k = await KollectyveClient.connect({ network: "local" });
   * ```
   */
  static async connect(
    options: KollectyveClientOptions = {},
    timeoutMs?: number,
  ): Promise<KollectyveClient> {
    const client = new KollectyveClient(options);
    try {
      await client.ready(timeoutMs);
    } catch (error) {
      client.destroy();
      throw error;
    }
    return client;
  }

  /** Resolve once the Substrate node is reachable; reject with a `ConnectionError` if not. */
  ready(timeoutMs?: number): Promise<void> {
    return this.substrate.client.ready(timeoutMs);
  }

  /** Tear down the Substrate connection. (viem clients need no explicit teardown.) */
  destroy(): void {
    this.substrate.destroy();
  }
}
