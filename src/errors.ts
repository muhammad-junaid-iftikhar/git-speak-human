export const EXIT = {
  OK: 0,
  USER: 1,
  CONFLICT: 2,
  SETUP: 3,
  NETWORK: 4,
} as const;

export interface BuddyErrorOptions {
  code?: string;
  exit?: number;
  hint?: string;
  details?: string;
}

export class BuddyError extends Error {
  code: string;
  exit: number;
  hint?: string;
  details?: string;

  constructor(message: string, opts: BuddyErrorOptions = {}) {
    super(message);
    this.code = opts.code ?? "user_error";
    this.exit = opts.exit ?? EXIT.USER;
    this.hint = opts.hint;
    this.details = opts.details;
  }
}

export const fail = (message: string, opts?: BuddyErrorOptions): never => {
  throw new BuddyError(message, opts);
};
