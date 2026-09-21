import { getContract, type Address, type GetContractReturnType } from "viem";
import type { EvmClient } from "../client.js";

/**
 * ABI of the sample `Storage` contract shipped in `kollectyve-chain/contracts`. Serves as the
 * pattern for wrapping any deployed contract: paste the compiled ABI here (or generate it),
 * and viem gives you fully-typed reads/writes with no extra codegen step.
 */
export const storageAbi = [
  { type: "constructor", inputs: [{ name: "initial", type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "retrieve", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "store", inputs: [{ name: "newNumber", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "increment", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  {
    type: "event",
    name: "NumberChanged",
    inputs: [
      { name: "by", type: "address", indexed: true },
      { name: "oldValue", type: "uint256", indexed: false },
      { name: "newValue", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

/** Typed handle to a deployed `Storage` contract. `read`/`write`/`getEvents` are fully typed. */
export function getStorageContract(
  client: EvmClient,
  address: Address,
): GetContractReturnType<typeof storageAbi, { public: EvmClient["public"]; wallet: EvmClient["wallet"] }, Address> {
  return getContract({
    address,
    abi: storageAbi,
    client: { public: client.public, wallet: client.wallet },
  });
}
