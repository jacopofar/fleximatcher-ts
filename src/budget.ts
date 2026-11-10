/**
 * Cooperative resource limits for matching.
 *
 * Matching is synchronous, so `timeoutMs` and `AbortSignal` are cooperative:
 * the engine checks the budget at rule boundaries and in the main matching
 * loops.  A single runaway regular expression or user function cannot be
 * interrupted by JavaScript, but built-in loops and tag closure respect it.
 */

import { FlexiMatcherError } from "./errors.js";

export interface BudgetOptions {
  /**
   * Maximum number of interpretation sequences to retain.  The match itself
   * is still decided correctly; only the collected result is truncated.
   * `0` or negative means unlimited.
   */
  maxInterpretations?: number;
  /**
   * Maximum number of annotations per store.  Additional annotations are
   * discarded and `store.truncated` becomes true.  `0` or negative means
   * unlimited.
   */
  maxAnnotations?: number;
  /** Cooperative wall-clock deadline in milliseconds. */
  timeoutMs?: number;
  /** Abort matching cooperatively. */
  signal?: AbortSignal;
}

export type BudgetExceededReason = "timeout" | "aborted";

export class BudgetExceededError extends FlexiMatcherError {
  readonly reason: BudgetExceededReason;

  constructor(reason: BudgetExceededReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

function positiveLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

/** A reusable cooperative budget. */
export class Budget {
  readonly maxInterpretations: number | undefined;
  readonly maxAnnotations: number | undefined;
  readonly signal: AbortSignal | undefined;
  /** The configured wall-clock limit, if any (for diagnostics). */
  readonly timeoutMs: number | undefined;
  private readonly deadline: number | null;

  constructor(options: BudgetOptions = {}) {
    this.maxInterpretations = positiveLimit(options.maxInterpretations);
    this.maxAnnotations = positiveLimit(options.maxAnnotations);
    this.signal = options.signal;
    this.timeoutMs =
      options.timeoutMs !== undefined && options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : undefined;
    this.deadline =
      options.timeoutMs !== undefined && options.timeoutMs > 0
        ? Date.now() + options.timeoutMs
        : null;
  }

  /** Throw when the signal is aborted or the deadline has passed. */
  check(): void {
    if (this.signal?.aborted === true) {
      throw new BudgetExceededError("aborted", "Matching was aborted");
    }
    if (this.deadline !== null && Date.now() >= this.deadline) {
      throw new BudgetExceededError(
        "timeout",
        "Matching exceeded its time budget",
      );
    }
  }

  /** Whether a deadline or an aborted signal is already exhausted. */
  get exceeded(): boolean {
    return (
      this.signal?.aborted === true ||
      (this.deadline !== null && Date.now() >= this.deadline)
    );
  }
}
