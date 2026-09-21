import { defineChain } from "viem";
import { EVM_DECIMALS, KOLLECTYVE_CHAIN_ID, NETWORKS, TOKEN_SYMBOL } from "@kollectyve/core";

/** viem `Chain` definition for Kollectyve, parameterised by the eth-rpc endpoint. */
export function kollectyveChain(ethRpc: string = NETWORKS.testnet.ethRpc) {
  return defineChain({
    id: KOLLECTYVE_CHAIN_ID,
    name: "Kollectyve",
    nativeCurrency: { name: "Test Renaissance", symbol: TOKEN_SYMBOL, decimals: EVM_DECIMALS },
    rpcUrls: {
      default: { http: [ethRpc] },
    },
    testnet: true,
  });
}

/** Ready-made chain for the public testnet. */
export const kollectyveTestnet = kollectyveChain(NETWORKS.testnet.ethRpc);
