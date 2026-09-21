import { useState } from "react";
import { KollectyveProvider } from "@kollectyve/react";
import type { NetworkName } from "@kollectyve/sdk";
import { SubstratePanel } from "./panels/SubstratePanel.js";
import { EvmPanel } from "./panels/EvmPanel.js";
import { BridgePanel } from "./panels/BridgePanel.js";

export function App() {
  const [network, setNetwork] = useState<NetworkName>("testnet");

  return (
    // `key` forces a fresh provider — and a fresh websocket — when the network changes.
    <KollectyveProvider key={network} network={network} onChainMismatch="warn">
      <div className="app">
        <header>
          <div>
            <h1>Kollectyve testnet</h1>
            <p className="muted">
              One chain, two faces: the Substrate pallets and the EVM side of{" "}
              <code>pallet-revive</code>, through <code>@kollectyve/sdk</code>.
            </p>
          </div>
          <select value={network} onChange={(e) => setNetwork(e.target.value as NetworkName)}>
            <option value="testnet">testnet</option>
            <option value="local">local (dev-chain.sh)</option>
          </select>
        </header>

        <main>
          <SubstratePanel />
          <EvmPanel />
          <BridgePanel />
        </main>

        <footer className="muted">
          Substrate writes need a wallet extension (Polkadot-JS, Talisman, SubWallet) and a funded
          account. EVM writes need MetaMask on chain id 28000.
        </footer>
      </div>
    </KollectyveProvider>
  );
}
