/**
 * The {@link FlexiMatcher} entry point.
 */

import {
  AnnotationStore,
  Annotator,
  MatchFrame,
  MatchResult,
  buildDiagnostics,
  type Annotation,
} from "./annotations.js";
import { Budget, BudgetExceededError, type BudgetOptions } from "./budget.js";
import {
  FlexiMatcherError,
  PatternError,
  UnknownMacroError,
  UnknownRuleError,
} from "./errors.js";
import {
  isRuleChunk,
  parameter,
  ruleName,
  splitPattern,
} from "./expressions.js";
import {
  InsensitiveCaseRuleFactory,
  MultiRuleFactory,
  OptionalRuleFactory,
  OrRuleFactory,
  PlainTextRule,
  RegexRuleFactory,
  RepeatRuleFactory,
  SingleCharRuleFactory,
  WhitespaceRuleFactory,
  WordRuleFactory,
  type Rule,
  type RuleFactory,
} from "./rules.js";
import {
  RuleDefinition,
  TagRuleFactory,
  type TagRuleOptions,
} from "./tag.js";

export interface FlexiMatcherOptions {
  /** Include `__explain` in tag annotations by default. */
  explain?: boolean;
  /** Flags for the built-in `r` and `i` regexes. Defaults to `"u"`. */
  regexFlags?: string;
  /** Maximum regex span to consider; 0 means unlimited. */
  regexMaxSpan?: number;
  /** Maximum nested tag expansion depth. Defaults to `15`. */
  maximumTagNesting?: number;
  /** Throw {@link MaxNestingError} instead of silently stopping. */
  throwOnMaxDepth?: boolean;
  /** Pattern macros defined at construction time. */
  macros?: Record<string, string>;
}

export interface MatchOptions extends BudgetOptions {
  /**
   * When true (the default) the pattern must cover the whole text; when false
   * any substring may match.
   */
  matchWhole?: boolean;
  /**
   * When true, {@link MatchResult.interpretations} contains every distinct
   * sequence of annotations that produced the match.
   */
  populateResult?: boolean;
  /**
   * When false, matching stops as soon as a literal pattern chunk is known to
   * be absent.  Set it to true if you want the annotation store to contain
   * every annotation the rules can produce.
   */
  fullyAnnotate?: boolean;
  /** An existing store to annotate.  By default a fresh one is created. */
  store?: AnnotationStore;
  /** Override the matcher-wide explanation setting for this call. */
  explain?: boolean;
  /** Optional score for each interpretation.  Higher scores sort first. */
  rankInterpretation?: (
    interpretation: readonly Annotation[],
    text: string,
  ) => number;
  /**
   * `all` keeps every interpretation (sorted when a ranker is present).
   * `best` keeps only the highest-scoring interpretations.
   */
  strategy?: "all" | "best";
}

export interface InternalMatchOptions {
  store: AnnotationStore;
  frame: MatchFrame;
  fullyAnnotate: boolean;
  matchWhole: boolean;
  populateResult: boolean;
  budget: Budget;
}

/** A rule chunk or compiled pattern accepted by {@link FlexiMatcher.annotate}. */
export type AnnotateRule = string | CompiledPattern;

export interface AnnotateOptions extends BudgetOptions {
  /** Rule chunks (or compiled patterns) to run over the text. */
  rules: readonly AnnotateRule[];
  /** Existing store to annotate.  A fresh one is created by default. */
  store?: AnnotationStore;
  /** Override the matcher-wide explanation setting for this run. */
  explain?: boolean;
  /** Annotate fully even after a literal chunk is known to be missing. */
  fullyAnnotate?: boolean;
  /**
   * `throw` (default) stops at the first failing rule.
   * `collect` records the failure and continues with the remaining rules.
   */
  onError?: "throw" | "collect";
}

export interface AnnotateError {
  rule: string;
  error: unknown;
}

export interface AnnotateResult {
  store: AnnotationStore;
  annotations: readonly Annotation[];
  errors: readonly AnnotateError[];
  /** Whether annotation collection hit a limit. */
  truncated: boolean;
}

/** Options for {@link FlexiMatcher.annotateBatch}.  A batch cannot share a store. */
export interface BatchAnnotateOptions extends Omit<AnnotateOptions, "store"> {
  /** Aggregate annotation counts by type.  Defaults to `true`. */
  collectUsage?: boolean;
}

export interface BatchAnnotateResult {
  /** One result per input text, in input order. */
  results: AnnotateResult[];
  /** Annotation counts by type across the batch; empty when disabled. */
  usage: Record<string, number>;
}

/** One resolved chunk of a compiled pattern. */
export interface CompiledPart {
  /** The original chunk, e.g. `[i:pear]`. */
  readonly chunk: string;
  /** The rule name, or `null` for literal text. */
  readonly name: string | null;
  /** The rule parameter (empty for literal text). */
  readonly parameter: string;
  /** The factory that produced the rule, or `null` for literal text. */
  factory: RuleFactory | null;
  /** The rule instance, refreshed if the binding changes. */
  rule: Rule;
  /** Whether the sequence matcher may skip this chunk. */
  optional: boolean;
}

/**
 * A pattern that has already been split and resolved to rule instances.
 *
 * Compile once, match many times:
 *
 * ```ts
 * const compiled = matcher.compile("the [i:dog] eats [tag:fruit]");
 * for (const line of lines) {
 *   const result = compiled.matches(line, { populateResult: true });
 * }
 * ```
 *
 * Compiled patterns survive rule rebinding: the rule binding is checked on
 * each match and a new rule instance is created only when the factory changed.
 * Tag grammar changes are always picked up, because `[tag:...]` reads the
 * current productions at match time.
 */
export class CompiledPattern {
  /** The original pattern string. */
  readonly pattern: string;
  /** The pattern after macro expansion. */
  readonly expandedPattern: string;
  /** The chunks produced by {@link splitPattern}. */
  readonly chunks: readonly string[];
  /** The matcher this pattern was compiled with. */
  readonly matcher: FlexiMatcher;
  /** @internal Resolved chunks, reused across matches. */
  readonly parts: CompiledPart[];
  private bindingsVersion: number;

  constructor(matcher: FlexiMatcher, pattern: string) {
    this.matcher = matcher;
    this.pattern = pattern;
    this.expandedPattern = matcher._expandMacros(pattern);
    const chunks = splitPattern(this.expandedPattern);
    this.chunks = chunks;
    this.parts = matcher._resolveParts(this.expandedPattern, chunks);
    this.bindingsVersion = matcher._bindingsVersion;
  }

  /**
   * Refresh rule instances whose bindings changed since compilation.
   *
   * @internal
   */
  refresh(): void {
    if (this.bindingsVersion === this.matcher._bindingsVersion) {
      return;
    }
    for (const part of this.parts) {
      if (part.name === null) {
        continue;
      }
      const factory = this.matcher.getBoundRule(part.name);
      if (factory === undefined) {
        throw new UnknownRuleError(
          `The rule ${JSON.stringify(part.name)} is no longer bound (compiled pattern: ${JSON.stringify(this.pattern)})`,
        );
      }
      if (factory !== part.factory) {
        part.factory = factory;
        part.rule = factory.getRule(part.parameter);
        part.optional = factory.optional === true;
      }
    }
    this.bindingsVersion = this.matcher._bindingsVersion;
  }

  /** Match this compiled pattern against `text`. */
  matches(text: string, options: MatchOptions = {}): MatchResult {
    return this.matcher.matches(text, this, options);
  }

  /** Whether a substring of `text` matches this compiled pattern. */
  contains(text: string): boolean {
    return this.matcher.contains(text, this);
  }

  /** Build a sample string from this compiled pattern. */
  generateSample(): string {
    return this.matcher.generateSample(this);
  }

  toString(): string {
    return `CompiledPattern(${JSON.stringify(this.pattern)})`;
  }
}

function annotatorPattern(rule: string): string {
  const trimmed = rule.trim();
  return trimmed.startsWith("[") ? trimmed : `[${trimmed}]`;
}

/** The indices of the parts the sequence matcher may skip, or undefined. */
function optionalPartIndices(
  parts: readonly CompiledPart[],
): ReadonlySet<number> | undefined {
  let optional: Set<number> | undefined;
  parts.forEach((part, index) => {
    if (!part.optional) {
      return;
    }
    optional ??= new Set<number>();
    optional.add(index);
  });
  return optional;
}

/**
 * A configurable annotator and bottom-up pattern matcher.
 *
 * Create one instance, bind any custom rules you need, define tags, then call
 * {@link matches} or {@link contains}.  The built-in rules are available
 * immediately:
 *
 * | rule      | meaning                                              |
 * | --------- | ---------------------------------------------------- |
 * | `i`       | case-insensitive literal text                        |
 * | `r`       | JavaScript regular expression                        |
 * | `multi`   | intersection of several sub-patterns                 |
 * | `char`    | a single Unicode code point (decimal or `0x` hex)    |
 * | `tag`     | a previously defined tag (a grammar production)      |
 *
 * @example
 * ```ts
 * const matcher = new FlexiMatcher();
 * matcher.matches("Hello world", "Hello [i:WORLD]").matching; // true
 * matcher.contains("the dog eats the pear", "the [i:PEAR]"); // true
 * ```
 */
export class FlexiMatcher {
  private readonly rules = new Map<string, RuleFactory>();
  private readonly macros = new Map<string, string>();
  private readonly tagFactory: TagRuleFactory;
  private explainValue: boolean;
  private version = 0;

  constructor(options: FlexiMatcherOptions = {}) {
    this.explainValue = options.explain ?? false;
    this.tagFactory = new TagRuleFactory(this);

    for (const [name, pattern] of Object.entries(options.macros ?? {})) {
      this.defineMacro(name, pattern);
    }

    this.bind(
      "r",
      new RegexRuleFactory({
        flags: options.regexFlags,
        maxSpan: options.regexMaxSpan,
      }),
    );
    this.bind(
      "i",
      new InsensitiveCaseRuleFactory({
        flags: options.regexFlags,
        maxSpan: options.regexMaxSpan,
      }),
    );
    this.bind("multi", new MultiRuleFactory(this));
    this.bind("or", new OrRuleFactory(this));
    this.bind("repeat", new RepeatRuleFactory(this));
    this.bind("optional", new OptionalRuleFactory(this));
    this.bind("ws", new WhitespaceRuleFactory());
    this.bind("word", new WordRuleFactory());
    this.bind("char", new SingleCharRuleFactory());
    this.bind("tag", this.tagFactory);

    if (options.maximumTagNesting !== undefined) {
      this.tagFactory.setMaximumNesting(options.maximumTagNesting);
    }
    if (options.throwOnMaxDepth !== undefined) {
      this.tagFactory.setThrowOnMaxDepth(options.throwOnMaxDepth);
    }
  }

  /** Whether tag annotations include `__explain` by default. */
  get explain(): boolean {
    return this.explainValue;
  }

  set explain(value: boolean) {
    this.explainValue = Boolean(value);
  }

  // ------------------------------------------------------------------
  // Rule binding
  // ------------------------------------------------------------------

  /**
   * Bind `factory` to `ruleName`; return whether it replaced a rule.
   *
   * @throws {@link PatternError} for an invalid rule name.
   */
  bind(ruleName: string, factory: RuleFactory): boolean {
    if (!ruleName) {
      throw new PatternError("A rule name cannot be empty");
    }
    if (ruleName.includes("[") || ruleName.includes("]") || ruleName.includes(":")) {
      throw new PatternError(
        `Invalid rule name ${JSON.stringify(ruleName)}: names cannot contain brackets or ':'`,
      );
    }
    const replaced = this.rules.has(ruleName);
    if (this.rules.get(ruleName) !== factory) {
      this.rules.set(ruleName, factory);
      this.version += 1;
      this.tagFactory.invalidateDependencies();
    }
    return replaced;
  }

  /** Remove a rule binding; return whether it existed. */
  unbind(ruleName: string): boolean {
    const removed = this.rules.delete(ruleName);
    if (removed) {
      this.version += 1;
      this.tagFactory.invalidateDependencies();
    }
    return removed;
  }

  /** @internal Monotonic rule-binding version used by compiled patterns. */
  get _bindingsVersion(): number {
    return this.version;
  }

  /** Whether `ruleName` is currently bound. */
  isBoundRule(ruleName: string): boolean {
    return this.rules.has(ruleName);
  }

  /** Return the factory bound to `ruleName`, or `undefined`. */
  getBoundRule(ruleName: string): RuleFactory | undefined {
    return this.rules.get(ruleName);
  }

  /** The names of every bound rule. */
  get ruleNames(): readonly string[] {
    return [...this.rules.keys()];
  }

  // ------------------------------------------------------------------
  // Pattern macros
  // ------------------------------------------------------------------

  /** Define or replace a compile-time pattern macro. */
  defineMacro(name: string, pattern: string): void {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      throw new PatternError(
        `Invalid macro name ${JSON.stringify(name)}: use letters, digits, '_', '.' or '-'`,
      );
    }
    this.macros.set(name, pattern);
  }

  /** Remove a macro; return whether it existed. */
  removeMacro(name: string): boolean {
    return this.macros.delete(name);
  }

  /** Remove every macro. */
  clearMacros(): void {
    this.macros.clear();
  }

  /** The currently defined macro names. */
  get macroNames(): readonly string[] {
    return [...this.macros.keys()];
  }

  /** Return a macro's pattern, if defined. */
  getMacro(name: string): string | undefined {
    return this.macros.get(name);
  }

  /**
   * Expand `{{name}}` references in a pattern.
   *
   * Macro names use letters, digits, `_`, `.` and `-`.  Expansion is recursive
   * and cycle-checked.  Macros are intended as compile-time fragments; a
   * compiled pattern keeps the expansion it was created with.
   *
   * @internal
   */
  _expandMacros(pattern: string): string {
    if (this.macros.size === 0 || !pattern.includes("{{")) {
      return pattern;
    }

    const expand = (text: string, depth: number, stack: readonly string[]): string => {
      if (depth > 64) {
        throw new PatternError("Pattern macro expansion exceeded its depth limit");
      }
      return text.replace(/\{\{([A-Za-z0-9_.-]+)\}\}/g, (whole, name: string) => {
        const macro = this.macros.get(name);
        if (macro === undefined) {
          throw new UnknownMacroError(
            `The pattern macro ${JSON.stringify(name)} is not defined`,
          );
        }
        if (stack.includes(name)) {
          throw new PatternError(
            `Cyclic pattern macro expansion: ${[...stack, name].join(" → ")}`,
          );
        }
        return expand(macro, depth + 1, [...stack, name]);
      });
    };

    return expand(pattern, 0, []);
  }

  // ------------------------------------------------------------------
  // Compilation
  // ------------------------------------------------------------------

  /**
   * Compile `pattern` once and reuse it for many matches.
   *
   * Compilation splits the pattern and resolves every rule chunk to a rule
   * instance.  This is the recommended fast path for large grammars and for
   * loops that match the same pattern against many texts.
   *
   * @throws {@link UnknownRuleError} when the pattern refers to an unbound rule.
   * @throws {@link PatternError} when the pattern is malformed.
   */
  compile(pattern: string): CompiledPattern {
    return new CompiledPattern(this, pattern);
  }

  /**
   * Resolve pattern chunks to rules.
   *
   * @internal
   */
  _resolveParts(pattern: string, chunks: readonly string[]): CompiledPart[] {
    const factories = new Map(this.rules);
    return chunks.map((chunk) => {
      if (!isRuleChunk(chunk)) {
        return {
          chunk,
          name: null,
          parameter: "",
          factory: null,
          rule: new PlainTextRule(chunk),
          optional: false,
        };
      }

      const name = ruleName(chunk);
      const factory = factories.get(name);
      if (factory === undefined) {
        throw new UnknownRuleError(
          `The rule ${JSON.stringify(name)} is unknown; bind it before matching (pattern: ${JSON.stringify(pattern)})`,
        );
      }
      const parameterText = parameter(chunk);
      return {
        chunk,
        name,
        parameter: parameterText,
        factory,
        rule: factory.getRule(parameterText),
        optional: factory.optional === true,
      };
    });
  }

  // ------------------------------------------------------------------
  // Matching
  // ------------------------------------------------------------------

  /**
   * Match `pattern` against `text`.
   *
   * `pattern` may be a string or a pattern previously returned by
   * {@link compile}.
   *
   * @throws {@link UnknownRuleError} when the pattern refers to an unbound rule.
   * @throws {@link PatternError} when the pattern is malformed.
   */
  matches(
    text: string,
    pattern: string | CompiledPattern,
    options: MatchOptions = {},
  ): MatchResult {
    const budget = new Budget(options);
    let store = options.store;
    if (store === undefined) {
      store = new AnnotationStore({
        explain: options.explain ?? this.explainValue,
        text,
        maxAnnotations: budget.maxAnnotations,
      });
    } else {
      store.attachText(text);
      if (options.explain !== undefined) {
        store.explain = options.explain;
      }
      if (budget.maxAnnotations !== undefined) {
        store.maxAnnotations = budget.maxAnnotations;
      }
    }

    const frame = new MatchFrame("", 0);
    const internalOptions: InternalMatchOptions = {
      store,
      frame,
      fullyAnnotate: options.fullyAnnotate ?? false,
      matchWhole: options.matchWhole ?? true,
      populateResult: options.populateResult ?? false,
      budget,
    };

    let result: MatchResult;
    if (pattern instanceof CompiledPattern) {
      if (pattern.matcher !== this) {
        throw new FlexiMatcherError(
          "This CompiledPattern belongs to a different FlexiMatcher",
        );
      }
      result = this._matchCompiled(text, pattern, internalOptions);
    } else {
      result = this._match(text, pattern, internalOptions);
    }
    return this._rank(result, text, options);
  }

  private _rank(
    result: MatchResult,
    text: string,
    options: MatchOptions,
  ): MatchResult {
    if (
      result.interpretations === undefined ||
      options.rankInterpretation === undefined
    ) {
      return result;
    }
    const scored = result.interpretations.map((sequence) => ({
      sequence,
      score: options.rankInterpretation!(sequence, text),
    }));
    scored.sort((left, right) => right.score - left.score);
    const chosen =
      options.strategy === "best" && scored.length > 0
        ? scored.filter((entry) => entry.score === scored[0].score)
        : scored;
    return new MatchResult(result.matching, {
      emptyMatch: result.emptyMatch,
      interpretations: chosen.map((entry) => entry.sequence),
      store: result.store,
      truncated: result.truncated,
      scores: chosen.map((entry) => entry.score),
      diagnostics: {
        ...result.diagnostics,
        interpretations: chosen.length,
        warnings: [
          ...result.diagnostics.warnings,
          ...(options.strategy === "best"
            ? ["Only the highest-scoring interpretations were kept (strategy: best)."]
            : []),
        ],
      },
    });
  }

  /** Whether a substring of `text` matches `pattern`. */
  contains(text: string, pattern: string | CompiledPattern): boolean {
    return this.matches(text, pattern, { matchWhole: false }).matching;
  }

  /**
   * Run a list of annotator rules over a text, without requiring a pattern.
   *
   * This is the annotation-only counterpart to {@link matches}.  Each rule is
   * run with `matchWhole: false` and shares one annotation store, so the result
   * contains the union of every rule's annotations.  Tags are expanded
   * normally; `explain` controls whether tag annotations record `__explain`.
   *
   * ```ts
   * const result = matcher.annotate("Le case", {
   *   rules: ["[it-article]", "[it-noun]"],
   * });
   * result.annotations; // article + noun annotations
   * ```
   *
   * Bare rule names are wrapped in brackets: `it-noun` becomes `[it-noun]`.
   * A string that already starts with `[` is used verbatim.  Use
   * {@link matches} for full multi-chunk patterns.
   */
  annotate(text: string, options: AnnotateOptions): AnnotateResult {
    const budget = new Budget(options);
    let store = options.store;
    if (store === undefined) {
      store = new AnnotationStore({
        explain: options.explain ?? this.explainValue,
        text,
        maxAnnotations: budget.maxAnnotations,
      });
    } else {
      store.attachText(text);
      if (options.explain !== undefined) {
        store.explain = options.explain;
      }
      if (budget.maxAnnotations !== undefined) {
        store.maxAnnotations = budget.maxAnnotations;
      }
    }

    const frame = new MatchFrame("", 0);
    const errors: AnnotateError[] = [];
    const fullyAnnotate = options.fullyAnnotate ?? true;
    const onError = options.onError ?? "throw";
    let truncated = store.truncated;

    for (const rule of options.rules) {
      if (typeof rule === "string" && rule.trim() === "") {
        continue;
      }
      const pattern = typeof rule === "string" ? annotatorPattern(rule) : rule;
      const label = typeof pattern === "string" ? pattern : pattern.pattern;
      try {
        let result: MatchResult;
        if (typeof pattern === "string") {
          result = this._match(text, pattern, {
            store,
            frame: frame.child(pattern, store.size),
            fullyAnnotate,
            matchWhole: false,
            populateResult: false,
            budget,
          });
        } else {
          result = this._matchCompiled(text, pattern, {
            store,
            frame: frame.child(pattern.pattern, store.size),
            fullyAnnotate,
            matchWhole: false,
            populateResult: false,
            budget,
          });
        }
        truncated = truncated || result.truncated;
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          throw error;
        }
        if (onError === "throw") {
          throw error;
        }
        errors.push({ rule: label, error });
      }
    }

    return {
      store,
      annotations: store.annotations,
      errors,
      truncated: truncated || store.truncated,
    };
  }

  /**
   * Annotate several texts with the same rules, in one call.
   *
   * Each text gets its own store, so the results are independent; the aggregate
   * `usage` map counts annotations by type across the batch and is the metric
   * for "which annotators fired".  It is deliberately a thin loop over
   * {@link annotate}: the core remains synchronous and per-text.
   */
  annotateBatch(
    texts: readonly string[],
    options: BatchAnnotateOptions,
  ): BatchAnnotateResult {
    const results: AnnotateResult[] = [];
    const usage: Record<string, number> = {};
    const collectUsage = options.collectUsage ?? true;
    for (const text of texts) {
      const result = this.annotate(text, options);
      results.push(result);
      if (collectUsage) {
        for (const [type, count] of Object.entries(result.store.usage())) {
          usage[type] = (usage[type] ?? 0) + count;
        }
      }
    }
    return { results, usage };
  }

  /**
   * Internal entry point used by rules that recurse into the matcher.
   *
   * @internal
   */
  _match(text: string, pattern: string, options: InternalMatchOptions): MatchResult {
    const expanded = this._expandMacros(pattern);
    const chunks = splitPattern(expanded);
    const parts = this._resolveParts(expanded, chunks);
    return this._matchParts(text, chunks, parts, options);
  }

  /**
   * Match an already-compiled pattern.
   *
   * @internal
   */
  _matchCompiled(
    text: string,
    pattern: CompiledPattern,
    options: InternalMatchOptions,
  ): MatchResult {
    pattern.refresh();
    return this._matchParts(text, pattern.chunks, pattern.parts, options);
  }

  private _matchParts(
    text: string,
    chunks: readonly string[],
    parts: readonly CompiledPart[],
    options: InternalMatchOptions,
  ): MatchResult {
    options.budget.check();
    const constraints = {
      maxInterpretations: options.budget.maxInterpretations,
      maxAnnotations: options.budget.maxAnnotations,
      timeoutMs: options.budget.timeoutMs,
      aborted: options.budget.signal?.aborted ?? false,
    };

    if (chunks.length === 0) {
      const matching = options.matchWhole ? text.length === 0 : true;
      const interpretations =
        options.populateResult && matching ? [[]] : undefined;
      return new MatchResult(matching, {
        emptyMatch: true,
        interpretations,
        store: options.store,
        truncated: options.store.truncated,
        diagnostics: buildDiagnostics({
          store: options.store,
          interpretations: interpretations?.length ?? 0,
          truncated: options.store.truncated,
          constraints,
        }),
      });
    }

    let surelyWrongPart: { index: number; chunk: string } | null = null;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] as CompiledPart;
      if (part.name === null && !text.includes(part.chunk)) {
        if (!options.fullyAnnotate) {
          return new MatchResult(false, {
            store: options.store,
            truncated: options.store.truncated,
            diagnostics: buildDiagnostics({
              store: options.store,
              truncated: options.store.truncated,
              missingPart: { index, chunk: part.chunk },
              constraints,
            }),
          });
        }
        surelyWrongPart ??= { index, chunk: part.chunk };
      }
    }

    for (const part of parts) {
      options.budget.check();
      part.rule.annotate(
        text,
        new Annotator(
          options.store,
          this,
          options.frame,
          part.chunk,
          text,
          options.budget,
        ),
      );
    }

    if (surelyWrongPart !== null) {
      return new MatchResult(false, {
        store: options.store,
        truncated: options.store.truncated,
        diagnostics: buildDiagnostics({
          store: options.store,
          truncated: options.store.truncated,
          missingPart: surelyWrongPart,
          constraints,
        }),
      });
    }

    const checked = options.store.checkSequence(chunks, text.length, {
      matchWhole: options.matchWhole,
      populateResult: options.populateResult,
      budget: options.budget,
      maxInterpretations: options.budget.maxInterpretations,
      optional: optionalPartIndices(parts),
    });
    const truncated = options.store.truncated || checked.truncated === true;
    return new MatchResult(checked.matching, {
      interpretations: checked.interpretations,
      store: options.store,
      truncated,
      diagnostics: buildDiagnostics({
        store: options.store,
        interpretations: checked.interpretations?.length ?? 0,
        truncated,
        missingPart: checked.missingPart ?? null,
        furthestEnd: checked.furthestEnd,
        constraints,
      }),
    });
  }

  // ------------------------------------------------------------------
  // Sample generation
  // ------------------------------------------------------------------

  /**
   * Build a sample string from `pattern` where possible.
   *
   * Rule factories that cannot generate a sample (regular expressions,
   * `multi`) leave their original chunk in place as a visible placeholder.
   */
  generateSample(pattern: string | CompiledPattern): string {
    if (pattern instanceof CompiledPattern) {
      pattern.refresh();
      return pattern.parts
        .map((part) => {
          if (part.name === null) {
            return part.chunk;
          }
          const sample = part.factory?.generateSample(part.parameter);
          return sample ?? part.chunk;
        })
        .join("");
    }

    const factories = new Map(this.rules);
    const pieces: string[] = [];

    for (const part of splitPattern(this._expandMacros(pattern))) {
      if (!isRuleChunk(part)) {
        pieces.push(part);
        continue;
      }
      const name = ruleName(part);
      const factory = factories.get(name);
      if (factory === undefined) {
        pieces.push(part);
        continue;
      }
      const sample = factory.generateSample(parameter(part));
      pieces.push(sample ?? part);
    }

    return pieces.join("");
  }

  // ------------------------------------------------------------------
  // Tags
  // ------------------------------------------------------------------

  /** Add a production for `tag` (see {@link TagRuleFactory.addTagRule}). */
  addTagRule<TData = unknown>(
    tag: string,
    pattern: string,
    options: TagRuleOptions<TData> = {},
  ): boolean {
    return this.tagFactory.addTagRule(tag, pattern, options);
  }

  /** Add an already-built {@link RuleDefinition} for `tag`. */
  addTagDefinition<TData = unknown>(
    tag: string,
    definition: RuleDefinition<TData>,
  ): boolean {
    return this.tagFactory.addTagDefinition(tag, definition);
  }

  /** Remove a tag production by identifier. */
  removeTagRule(tag: string, identifier: string): boolean {
    return this.tagFactory.removeTagRule(tag, identifier);
  }

  /** Remove every tag production. */
  clearTags(): void {
    this.tagFactory.clearTags();
  }

  /** The names of the currently defined tags. */
  get tagNames(): readonly string[] {
    return this.tagFactory.tagNames;
  }

  /** The productions of `tag`. */
  tagDefinitions(tag: string): readonly RuleDefinition[] {
    return this.tagFactory.tagDefinitions(tag);
  }

  /** Return a tag production by tag name and identifier. */
  getTagRule(tag: string, identifier: string): RuleDefinition | undefined {
    return this.tagFactory.getTagRule(tag, identifier);
  }

  /** Maximum nested tag expansion depth (default `15`). */
  get maximumTagNesting(): number {
    return this.tagFactory.maximumNesting;
  }

  set maximumTagNesting(depth: number) {
    this.tagFactory.setMaximumNesting(depth);
  }

  /** Set the maximum nested tag expansion depth. */
  setMaximumTagNesting(depth: number): void {
    this.tagFactory.setMaximumNesting(depth);
  }

  /** Whether exceeding the nesting limit raises {@link MaxNestingError}. */
  get throwOnMaxDepth(): boolean {
    return this.tagFactory.throwOnMaxDepth;
  }

  set throwOnMaxDepth(value: boolean) {
    this.tagFactory.throwOnMaxDepth = value;
  }

  /** Whether exceeding the nesting limit raises {@link MaxNestingError}. */
  throwExceptionWhenReachingMaximumDepth(throwIt: boolean): void {
    this.tagFactory.setThrowOnMaxDepth(throwIt);
  }

  toString(): string {
    return `FlexiMatcher(rules=${JSON.stringify(this.ruleNames)}, tags=${JSON.stringify(this.tagNames)})`;
  }
}
