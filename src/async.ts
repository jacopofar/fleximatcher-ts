/**
 * Async rule adapter.
 *
 * The core matcher is synchronous by design.  External models are usually
 * asynchronous, so this module supports a prefetch pattern:
 *
 * 1. await an async factory's `analyze` for the target text;
 * 2. bind a synchronous cached rule under the async rule's name;
 * 3. run normal `matches`/`annotate`, including tag closure.
 *
 * The cached rules are plain sync rules, so tags and pattern composition work
 * normally.  Release the prefetched bindings when you are done.
 */

import type { MatchResult } from "./annotations.js";
import { RuleError } from "./errors.js";
import type {
  AnnotateOptions,
  AnnotateResult,
  FlexiMatcher,
  MatchOptions,
} from "./matcher.js";
import type { Rule, RuleFactory } from "./rules.js";

/** A span produced by an async annotator. */
export interface AsyncAnnotationInput {
  start: number;
  end: number;
  data?: unknown;
}

/** An asynchronous annotation source. */
export interface AsyncRuleFactory {
  /** Analyze `text` and return spans for the given parameter. */
  analyze(
    text: string,
    parameter: string,
  ): Promise<readonly AsyncAnnotationInput[]>;
  /** Optional sample generation, delegated to the cached factory. */
  generateSample(parameter: string): string | null | undefined;
}

export interface AsyncRuleBinding {
  /** Rule name used in patterns, e.g. `remote-pos`. */
  name: string;
  factory: AsyncRuleFactory;
  /** Parameters to prefetch.  Defaults to `[""]`. */
  parameters?: readonly string[];
}

/** Restore the rule bindings that existed before a prefetch. */
export interface PrefetchedRules {
  release(): void;
}

class CachedAsyncRuleFactory implements RuleFactory {
  private readonly text: string;
  private readonly caches: ReadonlyMap<string, readonly AsyncAnnotationInput[]>;
  private readonly source: AsyncRuleFactory;

  constructor(
    text: string,
    caches: ReadonlyMap<string, readonly AsyncAnnotationInput[]>,
    source: AsyncRuleFactory,
  ) {
    this.text = text;
    this.caches = caches;
    this.source = source;
  }

  getRule(parameter: string): Rule {
    const annotations = this.caches.get(parameter);
    if (annotations === undefined) {
      throw new RuleError(
        `No async annotations were prefetched for parameter ${JSON.stringify(parameter)}`,
      );
    }
    const expectedText = this.text;
    return {
      annotate(text, annotator) {
        if (text !== expectedText) {
          throw new RuleError(
            "Async annotations were prefetched for a different text",
          );
        }
        for (const annotation of annotations) {
          annotator.add(annotation.start, annotation.end, annotation.data);
        }
        return false;
      },
    };
  }

  generateSample(parameter: string): string | null | undefined {
    return this.source.generateSample(parameter);
  }
}

/**
 * Await every async binding and bind cached synchronous rules.
 *
 * Bindings are restored by `release()`.  The returned handle can be used
 * manually, or indirectly through {@link matchesAsync}/{@link annotateAsync}.
 */
export async function prefetchAsyncRules(
  matcher: FlexiMatcher,
  text: string,
  bindings: readonly AsyncRuleBinding[],
): Promise<PrefetchedRules> {
  const previous = new Map<string, RuleFactory | undefined>();
  const caches = new Map<
    string,
    Map<string, readonly AsyncAnnotationInput[]>
  >();

  try {
    for (const binding of bindings) {
      if (!caches.has(binding.name)) {
        previous.set(binding.name, matcher.getBoundRule(binding.name));
        caches.set(binding.name, new Map());
      }
      const cache = caches.get(binding.name) as Map<
        string,
        readonly AsyncAnnotationInput[]
      >;
      const parameters = binding.parameters ?? [""];
      for (const parameter of parameters) {
        cache.set(parameter, await binding.factory.analyze(text, parameter));
      }
    }

    const bound = new Map<string, RuleFactory>();
    for (const binding of bindings) {
      if (bound.has(binding.name)) continue;
      const cache = caches.get(binding.name);
      if (cache === undefined) continue;
      const factory = new CachedAsyncRuleFactory(text, cache, binding.factory);
      matcher.bind(binding.name, factory);
      bound.set(binding.name, factory);
    }

    let released = false;
    return {
      release(): void {
        if (released) return;
        released = true;
        for (const [name, factory] of bound) {
          if (matcher.getBoundRule(name) !== factory) {
            continue;
          }
          const original = previous.get(name);
          if (original === undefined) {
            matcher.unbind(name);
          } else {
            matcher.bind(name, original);
          }
        }
      },
    };
  } catch (error) {
    for (const [name, original] of previous) {
      if (original === undefined) {
        matcher.unbind(name);
      } else {
        matcher.bind(name, original);
      }
    }
    throw error;
  }
}

export interface AsyncMatchOptions extends MatchOptions {
  /** Async factories to prefetch before matching. */
  asyncRules: readonly AsyncRuleBinding[];
}

export type AsyncMatchResult = MatchResult & { release(): void };

/**
 * Prefetch async rules, then call {@link FlexiMatcher.matches}.
 *
 * The prefetched rules remain bound until `release()` so tag closure can use
 * them.  Call `release()` in a `finally` block.
 */
export async function matchesAsync(
  matcher: FlexiMatcher,
  text: string,
  pattern: string,
  options: AsyncMatchOptions,
): Promise<AsyncMatchResult> {
  const { asyncRules, ...matchOptions } = options;
  const prefetched = await prefetchAsyncRules(matcher, text, asyncRules);
  try {
    const result = matcher.matches(text, pattern, matchOptions);
    return Object.assign(result, { release: () => prefetched.release() });
  } catch (error) {
    prefetched.release();
    throw error;
  }
}

export interface AsyncAnnotateOptions extends Omit<AnnotateOptions, "rules"> {
  /** Synchronous annotator chunks to run after prefetching. */
  rules: readonly string[];
  /** Async factories to prefetch before annotating. */
  asyncRules: readonly AsyncRuleBinding[];
}

export type AsyncAnnotateResult = AnnotateResult & { release(): void };

/** Prefetch async rules, then call {@link FlexiMatcher.annotate}. */
export async function annotateAsync(
  matcher: FlexiMatcher,
  text: string,
  options: AsyncAnnotateOptions,
): Promise<AsyncAnnotateResult> {
  const { asyncRules, ...annotateOptions } = options;
  const prefetched = await prefetchAsyncRules(matcher, text, asyncRules);
  try {
    const result = matcher.annotate(text, annotateOptions);
    return Object.assign(result, { release: () => prefetched.release() });
  } catch (error) {
    prefetched.release();
    throw error;
  }
}
