import { TransactionError, userCommitment, type H256Hex, type IdentityId, type KycTier } from "@kollectyve/core";
import type { SubstrateClient } from "../client.js";
import { h256, tierFromChain, tierToChain } from "../codec.js";
import { watchEvent, type ChainEvent, type Unsubscribe, type WatchOptions } from "../events.js";
import type { SignerOrTxOptions } from "../tx.js";

/** `KollectyveId.IdentityRegistered` — a new identity was minted by the enrollment origin. */
export interface IdentityRegistered {
  id: IdentityId;
  controller: string;
  commitment: H256Hex;
}

/** `KollectyveId.TierSet` — the compliance origin changed an identity's KYC tier. */
export interface TierSet {
  id: IdentityId;
  tier: KycTier;
}

/** `KollectyveId.ControllerRotated` — a user moved their identity to a new account. */
export interface ControllerRotated {
  id: IdentityId;
  old: string;
  new: string;
}

/**
 * `pallet-kollectyve-id` — the stable on-chain identity anchor.
 *
 * Calls: `register_identity`, `set_tier`, `rotate_controller`.
 * Storage: `IdentityOf`, `ControllerOf`, `TierOf`, `NextIdentityId`, `UsedCommitments`,
 * `EnrollmentKey`, `ComplianceKey`.
 * Events: `IdentityRegistered`, `TierSet`, `ControllerRotated`.
 *
 * Only `rotate_controller` is open to ordinary users; registration and tier changes are
 * privileged (see the origin notes on each method).
 */
export class IdentityModule {
  constructor(private readonly c: SubstrateClient) {}

  // --- reads ---

  /** Resolve the controller account for an identity. */
  controllerOf(id: IdentityId): Promise<string | undefined> {
    return this.c.api.query.KollectyveId.ControllerOf.getValue(id);
  }

  /**
   * The identity controlled by `account`, if any — the reverse of {@link controllerOf} and the
   * lookup a dApp needs to answer "which identity is this wallet?".
   */
  identityOf(account: string): Promise<IdentityId | undefined> {
    return this.c.api.query.KollectyveId.IdentityOf.getValue(account);
  }

  /**
   * Current KYC tier of an identity. Storage is `ValueQuery`, so an identity that does not
   * exist reads as `"None"` rather than absent — use {@link controllerOf} to test existence.
   */
  async tierOf(id: IdentityId): Promise<KycTier> {
    return tierFromChain(await this.c.api.query.KollectyveId.TierOf.getValue(id));
  }

  /** The next identity id to be allocated. */
  nextId(): Promise<IdentityId> {
    return this.c.api.query.KollectyveId.NextIdentityId.getValue();
  }

  /**
   * The identity already bound to `commitment`, if the auth subject has been enrolled.
   * Lets a registrar check idempotency before submitting.
   */
  identityForCommitment(commitment: H256Hex): Promise<IdentityId | undefined> {
    return this.c.api.query.KollectyveId.UsedCommitments.getValue(h256(commitment));
  }

  /** The account wired as the enrollment origin at genesis. `undefined` = root/sudo only. */
  enrollmentKey(): Promise<string | undefined> {
    return this.c.api.query.KollectyveId.EnrollmentKey.getValue();
  }

  /** The account wired as the compliance origin at genesis. `undefined` = root/sudo only. */
  complianceKey(): Promise<string | undefined> {
    return this.c.api.query.KollectyveId.ComplianceKey.getValue();
  }

  // --- writes ---

  /**
   * Register a new identity for `controller` (**enrollment origin** — the hot registrar key,
   * or root on a `--dev` chain).
   *
   * `commitment` is the PII-free hash of the auth subject; it must be unique across all
   * identities, and the chain rejects a repeat. Build it with `userCommitment()` from
   * `@kollectyve/core`. The new identity always starts at tier `None`.
   */
  registerIdentity(controller: string, commitment: H256Hex, options?: SignerOrTxOptions) {
    return this.c.submit(
      this.c.api.tx.KollectyveId.register_identity({ controller, user_commitment: h256(commitment) }),
      options,
    );
  }

  /** Set the KYC tier of an existing identity (**compliance origin**). */
  setTier(id: IdentityId, tier: KycTier, options?: SignerOrTxOptions) {
    return this.c.submit(this.c.api.tx.KollectyveId.set_tier({ id, tier: tierToChain(tier) }), options);
  }

  /**
   * Move an identity to a new controller account — self-custody graduation or a key change.
   *
   * **Controller-only**: the signer must be the identity's current controller, and `next` must
   * not already control an identity. Neither privileged origin can rotate on a user's behalf.
   */
  rotateController(id: IdentityId, next: string, options?: SignerOrTxOptions) {
    return this.c.submit(this.c.api.tx.KollectyveId.rotate_controller({ id, new: next }), options);
  }

  /**
   * Idempotently enrol an auth subject — the flow a product backend runs on every signup.
   *
   * Hashes `subject` (a stable auth id, e.g. a BetterAuth user id) into the PII-free
   * commitment, returns the existing identity if that subject was already enrolled, and
   * otherwise registers one and reads the new id out of the `IdentityRegistered` event.
   *
   * Safe to call again after a timeout or a crash: the chain dedups on the commitment *and*
   * on the controller, and this checks both, so a retry converges instead of failing with
   * `AlreadyRegistered` or minting a second identity.
   *
   * ```ts
   * const { id, created } = await k.substrate.identity.enroll(custodialAddress, authUserId, signer);
   * ```
   *
   * Requires the **enrollment origin**. Returns `created: false` when the subject was already
   * known — in which case `controller` is ignored, since the identity already has one.
   */
  async enroll(
    controller: string,
    subject: string,
    options?: SignerOrTxOptions,
  ): Promise<{ id: IdentityId; created: boolean }> {
    const commitment = userCommitment(subject);

    // The chain dedups on BOTH keys, so check both before submitting. A caller whose own record
    // was lost re-derives the same custodial controller, and would otherwise hit
    // `AlreadyRegistered` rather than converging on the identity it already has.
    const byCommitment = await this.identityForCommitment(commitment);
    if (byCommitment !== undefined) return { id: byCommitment, created: false };
    const byController = await this.identityOf(controller);
    if (byController !== undefined) return { id: byController, created: false };

    const result = await this.registerIdentity(controller, commitment, options);
    if (!result.ok) {
      throw new TransactionError(
        `enrolling "${subject}" failed: ${JSON.stringify(result.dispatchError ?? "unknown error")}`,
      );
    }

    const [registered] = this.c.api.event.KollectyveId.IdentityRegistered.filter(result.events);
    if (registered) return { id: registered.id, created: true };

    // The extrinsic succeeded, so the identity exists; fall back to the commitment index in
    // case the event could not be decoded.
    const id = await this.identityForCommitment(commitment);
    if (id === undefined) throw new TransactionError(`enrolled "${subject}" but could not read back its id`);
    return { id, created: true };
  }

  // --- events (finalized blocks) ---

  /** Watch identities being minted. Returns an unsubscribe. */
  onIdentityRegistered(
    onEvent: (event: ChainEvent<IdentityRegistered>) => void,
    options?: WatchOptions<{ id: bigint; controller: string; commitment: { asHex: () => string } }>,
  ): Unsubscribe {
    return watchEvent(
      this.c.api.event.KollectyveId.IdentityRegistered,
      (p) => ({ id: p.id, controller: p.controller, commitment: p.commitment.asHex() as H256Hex }),
      onEvent,
      options,
    );
  }

  /** Watch KYC tier changes. */
  onTierSet(
    onEvent: (event: ChainEvent<TierSet>) => void,
    options?: WatchOptions<{ id: bigint; tier: { type: KycTier } }>,
  ): Unsubscribe {
    return watchEvent(
      this.c.api.event.KollectyveId.TierSet,
      (p) => ({ id: p.id, tier: tierFromChain(p.tier) }),
      onEvent,
      options,
    );
  }

  /** Watch identities moving to a new controller account. */
  onControllerRotated(
    onEvent: (event: ChainEvent<ControllerRotated>) => void,
    options?: WatchOptions<{ id: bigint; old: string; new: string }>,
  ): Unsubscribe {
    return watchEvent(
      this.c.api.event.KollectyveId.ControllerRotated,
      (p) => ({ id: p.id, old: p.old, new: p.new }),
      onEvent,
      options,
    );
  }
}
