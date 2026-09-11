/**
 * An audit failure that retrying cannot fix — it needs the merchant to act
 * (for example, supplying a storefront password). The worker marks these
 * failed immediately instead of spending a retry on them.
 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/** The storefront is behind a password StoreRx does not have, or has wrong. */
export class StorefrontLockedError extends NonRetryableError {
  constructor(message: string) {
    super(message);
    this.name = "StorefrontLockedError";
  }
}
