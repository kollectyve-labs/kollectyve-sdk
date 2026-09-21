import { useState } from "react";
import { formatUnits, type Address } from "viem";
import { useKollectyve, type ConnectedEvmWallet } from "@kollectyve/react";
import { EVM_DECIMALS, SUBSTRATE_DECIMALS, evmToAccountId32, evmToSs58 } from "@kollectyve/sdk";

/**
 * The point of the whole chain: one account, two views. Take an EVM address, derive its
 * Substrate identity via `pallet-revive`'s mapping, and read the *same* balance from both
 * sides (EVM 18-decimals vs Substrate 12-decimals of the one ledger entry).
 */
export function BridgePanel({ wallet }: { wallet: ConnectedEvmWallet | undefined }) {
  const k = useKollectyve();
  const [addr, setAddr] = useState<string>(wallet?.address ?? "0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac");
  const [out, setOut] = useState<{
    accountId: string; ss58: string; evm: string; substrate: string;
  }>();
  const [err, setErr] = useState<string>();

  async function bridge() {
    setErr(undefined);
    try {
      const evmAddr = addr as Address;
      const accountId = evmToAccountId32(evmAddr);
      const ss58 = evmToSs58(evmAddr);

      const evmBal = await k.evm.public.getBalance({ address: evmAddr });
      // Same account, read from the Substrate side via System.Account.
      const acct = await k.substrate.client.api.query.System.Account.getValue(ss58);
      const free: bigint = acct?.data?.free ?? 0n;

      setOut({
        accountId,
        ss58,
        evm: `${formatUnits(evmBal, EVM_DECIMALS)} tRS`,
        substrate: `${formatUnits(free, SUBSTRATE_DECIMALS)} tRS`,
      });
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
    }
  }

  return (
    <section className="panel bridge">
      <h2>③ Bridge — one account, two worlds</h2>
      <p className="muted">EVM address → Substrate identity → the same balance from both sides.</p>

      <div className="row">
        <input value={addr} onChange={(e) => setAddr(e.target.value)} className="mono" style={{ flex: 1 }} />
        <button onClick={bridge}>Bridge</button>
      </div>
      {wallet && (
        <button className="link" onClick={() => setAddr(wallet.address)}>use connected wallet</button>
      )}

      {err && <p className="error small">{err}</p>}
      {out && (
        <dl>
          <dt>AccountId32</dt><dd className="mono small">{out.accountId}</dd>
          <dt>SS58</dt><dd className="mono small">{out.ss58}</dd>
          <dt>EVM balance</dt><dd className="big">{out.evm}</dd>
          <dt>Substrate balance</dt><dd className="big">{out.substrate}</dd>
        </dl>
      )}
      <p className="muted small">
        Same funds; the EVM side is scaled up by <code>NativeToEthRatio</code> (10⁶) so it
        reads with {EVM_DECIMALS} decimals instead of {SUBSTRATE_DECIMALS}.
      </p>
    </section>
  );
}
