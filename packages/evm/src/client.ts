import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Account,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, type Hex } from "@kollectyve/core";
import { kollectyveChain } from "./chain.js";

export interface EvmClientOptions {
  /** eth-rpc endpoint. Defaults to the testnet proxy. */
  ethRpc?: string;
  /**
   * How to sign transactions. Omit for a read-only client.
   *  - `{ privateKey }`         — a local signer (backend, tests).
   *  - `{ eip1193 }`            — an injected wallet (MetaMask `window.ethereum`).
   */
  signer?: { privateKey: Hex } | { eip1193: EIP1193Provider };
}

export interface EvmClient {
  readonly chain: ReturnType<typeof kollectyveChain>;
  /** Read-only client (calls, balances, gas, receipts). */
  readonly public: PublicClient;
  /** Signing client, present only when a `signer` was supplied. */
  readonly wallet?: WalletClient;
  /** The active signing account, if any. */
  readonly account?: Account;
}

/** Build the EVM half of the SDK on top of viem, pointed at the eth-rpc proxy. */
export function createEvmClient(options: EvmClientOptions = {}): EvmClient {
  const ethRpc = options.ethRpc ?? NETWORKS.testnet.ethRpc;
  const chain = kollectyveChain(ethRpc);

  const publicClient = createPublicClient({ chain, transport: http(ethRpc) });

  if (!options.signer) return { chain, public: publicClient };

  if ("privateKey" in options.signer) {
    const account = privateKeyToAccount(options.signer.privateKey);
    const wallet = createWalletClient({ account, chain, transport: http(ethRpc) });
    return { chain, public: publicClient, wallet, account };
  }

  const wallet = createWalletClient({ chain, transport: custom(options.signer.eip1193) });
  return { chain, public: publicClient, wallet };
}
