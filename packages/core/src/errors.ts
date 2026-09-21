/** Base class for all errors thrown by the Kollectyve SDK, so callers can `instanceof` one type. */
export class KollectyveError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A bad address, malformed hex, or failed SS58 checksum. */
export class AddressError extends KollectyveError {}

/** A network / RPC transport failure (Substrate or EVM side). */
export class ConnectionError extends KollectyveError {}

/** An extrinsic or EVM transaction was rejected or reverted. */
export class TransactionError extends KollectyveError {}
