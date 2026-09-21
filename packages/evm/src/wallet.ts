import type { Address, EIP1193Provider } from "viem";
import { ConnectionError, EVM_DECIMALS, KOLLECTYVE_CHAIN_ID, NETWORKS, TOKEN_SYMBOL } from "@kollectyve/core";

/** An injected EVM wallet the user has connected. */
export interface ConnectedEvmWallet {
  address: Address;
  provider: EIP1193Provider;
}

export interface ConnectEvmWalletOptions {
  /** Defaults to `window.ethereum`. */
  provider?: EIP1193Provider;
  /** RPC to register if the wallet doesn't know Kollectyve yet. Defaults to the testnet. */
  ethRpc?: string;
  /** Set false to fail rather than offer to add the network. Default `true`. */
  addChainIfMissing?: boolean;
}

/** The injected EIP-1193 provider, if a wallet extension is present. */
export function getInjectedEvmProvider(): EIP1193Provider | undefined {
  return (globalThis as { ethereum?: EIP1193Provider }).ethereum;
}

/**
 * Point a wallet at Kollectyve, adding the network if it isn't there.
 *
 * Wallets answer `wallet_switchEthereumChain` with code 4902 for a chain they don't know;
 * that is the only error worth recovering from — 4001 (the user said no) must propagate.
 */
export async function switchToKollectyve(
  provider: EIP1193Provider,
  ethRpc: string = NETWORKS.testnet.ethRpc,
  addChainIfMissing = true,
): Promise<void> {
  const chainId = `0x${KOLLECTYVE_CHAIN_ID.toString(16)}` as const;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (switchError) {
    if ((switchError as { code?: number }).code !== 4902 || !addChainIfMissing) throw switchError;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: "Kollectyve",
          nativeCurrency: { name: "Test Renaissance", symbol: TOKEN_SYMBOL, decimals: EVM_DECIMALS },
          rpcUrls: [ethRpc],
        },
      ],
    } as Parameters<EIP1193Provider["request"]>[0]);
  }
}

/**
 * Prompt an injected EVM wallet for accounts and put it on the Kollectyve network.
 *
 * Framework-free, and the mirror of `connectSubstrateWallet` in `@kollectyve/substrate` — the
 * React `useConnectWallet` hook is a thin binding over this, and any other framework can call
 * it directly.
 *
 * ```ts
 * const { address, provider } = await connectEvmWallet({ ethRpc: k.endpoints.ethRpc });
 * const k2 = new KollectyveClient({ network: "local", evmSigner: { eip1193: provider } });
 * ```
 */
export async function connectEvmWallet(
  options: ConnectEvmWalletOptions = {},
): Promise<ConnectedEvmWallet> {
  const provider = options.provider ?? getInjectedEvmProvider();
  if (!provider) throw new ConnectionError("no injected EVM wallet found — install MetaMask");

  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  await switchToKollectyve(provider, options.ethRpc, options.addChainIfMissing ?? true);

  const address = accounts[0];
  if (!address) throw new ConnectionError("the wallet returned no accounts");
  return { address, provider };
}
