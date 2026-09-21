import type { SubstrateClient } from "../client.js";
import type { SignerOrTxOptions } from "../tx.js";

/**
 * `pallet-balances` — the native token, as the SDK's consumers need it.
 *
 * Deliberately minimal: a product backend funding a freshly-minted custodial account so it can
 * self-pay fees, and reading the funder's balance to know when the tap is running dry. Anything
 * richer belongs on the EVM side or in `unsafeApi`.
 */
export class BalancesModule {
  constructor(private readonly c: SubstrateClient) {}

  /**
   * Free balance of an account, in planck (1 UNIT = 1e12).
   *
   * Returns `0n` for an account that has never been funded — the chain reaps empty accounts, so
   * "absent" and "zero" are the same thing here.
   */
  async freeBalance(address: string): Promise<bigint> {
    const account = await this.c.api.query.System.Account.getValue(address);
    return account?.data.free ?? 0n;
  }

  /**
   * Transfer without letting the sender drop below the existential deposit.
   *
   * `transfer_keep_alive` rather than `transfer_allow_death`: a funding account that reaps
   * itself takes its own nonce and any in-flight extrinsics with it, and the failure looks like
   * an unrelated outage. Better to fail the transfer.
   */
  transferKeepAlive(dest: string, planck: bigint, options?: SignerOrTxOptions) {
    return this.c.submit(
      this.c.api.tx.Balances.transfer_keep_alive({ dest: { type: "Id", value: dest }, value: planck }),
      options,
    );
  }
}
