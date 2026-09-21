import {
  connectInjectedExtension,
  getInjectedExtensions,
  type InjectedExtension,
  type InjectedPolkadotAccount,
} from "polkadot-api/pjs-signer";
import { ConnectionError } from "@kollectyve/core";

export type { InjectedExtension, InjectedPolkadotAccount };

/**
 * Names of the Substrate wallet extensions injected into this page (`polkadot-js`, `talisman`,
 * `subwallet-js`, …). Empty when none is installed — or when called before the extensions have
 * finished injecting, which they do shortly after `window.onload`.
 */
export function getSubstrateWallets(): string[] {
  return getInjectedExtensions();
}

export interface ConnectedSubstrateWallet {
  extension: InjectedExtension;
  accounts: InjectedPolkadotAccount[];
  /** Watch for the user adding, removing or re-permissioning accounts. Returns an unsubscribe. */
  subscribe: (cb: (accounts: InjectedPolkadotAccount[]) => void) => () => void;
  disconnect: () => void;
}

/**
 * Connect a Substrate wallet extension and read its accounts. Prompts the user the first time
 * a dApp asks.
 *
 * Each returned account carries a ready `polkadotSigner`, which is exactly what the pallet
 * façades take:
 *
 * ```ts
 * const { accounts } = await connectSubstrateWallet("Kollectyve dApp");
 * await k.substrate.identity.rotateController(id, next, accounts[0].polkadotSigner);
 * ```
 *
 * Pass `wallet` to target a specific extension; by default the first available one is used.
 */
export async function connectSubstrateWallet(
  dappName = "Kollectyve",
  wallet?: string,
): Promise<ConnectedSubstrateWallet> {
  const available = getInjectedExtensions();
  const name = wallet ?? available[0];
  if (!name) {
    throw new ConnectionError(
      "no Substrate wallet extension found — install Polkadot-JS, Talisman or SubWallet",
    );
  }
  if (wallet && !available.includes(wallet)) {
    throw new ConnectionError(`wallet "${wallet}" not found; available: ${available.join(", ") || "none"}`);
  }

  let extension: InjectedExtension;
  try {
    extension = await connectInjectedExtension(name, dappName);
  } catch (cause) {
    throw new ConnectionError(`"${name}" rejected the connection`, { cause });
  }

  return {
    extension,
    accounts: extension.getAccounts(),
    subscribe: (cb) => extension.subscribe(cb),
    disconnect: () => extension.disconnect(),
  };
}
