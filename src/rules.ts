/**
 * Built-in rules and rule factories.
 *
 * A *rule* annotates a text.  A *rule factory* turns the parameter written in
 * a pattern chunk into a rule instance (and can also generate a sample string
 * for that parameter).  Users can bind their own factories with
 * {@link FlexiMatcher.bind}.
 */

import type { Annotator } from "./annotations.js";
import { PatternError, RuleError } from "./errors.js";
import { isRuleChunk, ruleName, splitPattern } from "./expressions.js";
import type { CompiledPattern, FlexiMatcher } from "./matcher.js";

/** A rule annotates a text and reports whether it matched it entirely. */
export interface Rule {
  /**
   * Annotate `text` through `annotator`.
   *
   * The return value is advisory: matching is decided by the annotations added
   * to the store.  It is nevertheless useful for rules that want to know
   * whether their own pattern covered the whole text.
   */
  annotate(text: string, annotator: Annotator): boolean;
}

/** Create rules from a parameter and optionally generate sample text. */
export interface RuleFactory {
  /** Return a rule configured with `parameter` (possibly empty). */
  getRule(parameter: string): Rule;
  /** Return a string matching `parameter`, or `null`/`undefined` if impossible. */
  generateSample(parameter: string): string | null | undefined;
  /**
   * Set this to `true` if the rule internally matches tag patterns through
   * `annotator.match`.  The tag closure then treats productions using this rule
   * as opaque and re-evaluates them when any tag annotation changes.  Pure
   * rules that only inspect the text should leave this false.
   */
  usesTags?: boolean;
  /**
   * Set this to `true` when the sequence matcher may skip this chunk.
   *
   * The built-in `optional` factory uses it.  A skipped chunk is simply absent
   * from the matched sequence, so it must not be combined with positional
   * `${N}` annotation templates.
   */
  optional?: boolean;
}

function sanitizeRegexFlags(flags: string): string {
  const unique = Array.from(new Set(flags.replace(/[gy]/g, "").split(""))).join(
    "",
  );
  return unique;
}

function regexError(source: string, error: unknown): RuleError {
  const reason = error instanceof Error ? error.message : String(error);
  return new RuleError(
    `Invalid regular expression ${JSON.stringify(source)}: ${reason}`,
    {
      cause: error,
    },
  );
}

/**
 * Annotate every occurrence of a literal string.
 *
 * Overlapping occurrences are also annotated: `"aa"` in `"aaaa"` yields spans
 * 0:2, 1:3 and 2:4.
 */
export class PlainTextRule implements Rule {
  readonly text: string;

  constructor(text: string) {
    if (!text) {
      throw new RuleError("A plain text rule cannot be empty");
    }
    this.text = text;
  }

  annotate(text: string, annotator: Annotator): boolean {
    const whole = text === this.text;
    let start = 0;
    while (true) {
      annotator.budget.check();
      const index = text.indexOf(this.text, start);
      if (index === -1) {
        break;
      }
      annotator.add(index, index + this.text.length);
      start = index + 1;
    }
    return whole;
  }

  toString(): string {
    return `PlainTextRule(${JSON.stringify(this.text)})`;
  }
}

/**
 * Annotate every span of the text that the regular expression matches.
 *
 * Spans are found exhaustively, including overlapping ones and alternatives
 * that a normal `finditer`/`exec` loop would skip, so the sequence matcher has
 * every possible interpretation available.
 *
 * Regexes are evaluated against suffixes of the text (as in the original
 * implementation), which means `^` matches at any candidate start position.
 * Exhaustive matching is O(n²) in the worst case; set `maxRegexSpan` when a
 * pattern can match long stretches of text.
 */
export class RegexRule implements Rule {
  readonly source: string;
  readonly flags: string;
  private readonly full: RegExp;
  private readonly probe: RegExp;
  private readonly maxSpan: number;

  constructor(pattern: string, flags = "u", maxSpan = 0) {
    if (!pattern) {
      throw new RuleError(
        "Cannot create a regex annotator with an empty pattern",
      );
    }
    const cleanFlags = sanitizeRegexFlags(flags);
    try {
      this.source = pattern;
      this.flags = cleanFlags;
      this.full = new RegExp(`^(?:${pattern})$`, cleanFlags);
      this.probe = new RegExp(pattern, `${cleanFlags}y`);
    } catch (error) {
      throw regexError(pattern, error);
    }
    this.maxSpan = maxSpan > 0 ? maxSpan : Number.POSITIVE_INFINITY;
  }

  private fullMatches(fragment: string): boolean {
    const match = this.full.exec(fragment);
    return match !== null && match[0].length === fragment.length;
  }

  annotate(text: string, annotator: Annotator): boolean {
    const fullTextMatch = this.fullMatches(text);
    const whole = fullTextMatch && text.length <= this.maxSpan;
    if (whole) {
      annotator.add(0, text.length);
    }

    const length = text.length;
    let ticks = 0;
    for (let start = 0; start < length; start += 1) {
      ticks += 1;
      if ((ticks & 63) === 0) {
        annotator.budget.check();
      }
      const tail = text.slice(start);
      this.probe.lastIndex = 0;
      if (!this.probe.test(tail)) {
        continue;
      }
      const limit = Math.min(length, start + this.maxSpan);
      for (let end = start + 1; end <= limit; end += 1) {
        if (((end - start) & 63) === 0) {
          annotator.budget.check();
        }
        if (this.fullMatches(tail.slice(0, end - start))) {
          annotator.add(start, end);
        }
      }
    }
    return whole;
  }

  toString(): string {
    return `RegexRule(${JSON.stringify(this.source)})`;
  }
}

/** Annotate every occurrence of a literal string, ignoring case. */
export class InsensitiveCaseRule extends RegexRule {
  constructor(text: string, flags = "u", maxSpan = 0) {
    if (!text) {
      throw new RuleError(
        "Cannot create a case-insensitive annotator with an empty pattern",
      );
    }
    super(escapeRegExp(text), `${flags}i`, maxSpan);
  }

  toString(): string {
    return `InsensitiveCaseRule(${JSON.stringify(this.source)})`;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Intersect the spans annotated by several sub-patterns.
 *
 * The parameter is a sequence of pattern chunks, for example
 * `[multi:[r:a[0-9]+][i:a3b]]`.  A span is annotated by the `multi` rule only
 * when every condition annotates exactly that span.  The extra pair of
 * brackets shown in the original README (`[multi:[[...]]]`) is accepted too.
 */
export class MultiRule implements Rule {
  readonly conditions: readonly string[];
  private readonly compiledConditions: readonly CompiledPattern[];

  constructor(conditions: string, matcher: FlexiMatcher) {
    this.conditions = multiConditions(conditions);
    this.compiledConditions = this.conditions.map((condition) =>
      matcher.compile(condition),
    );
  }

  annotate(text: string, annotator: Annotator): boolean {
    let candidate: Set<string> | null = null;
    let allMatch = true;

    for (const compiled of this.compiledConditions) {
      annotator.budget.check();
      const condition = compiled.pattern;
      const result = annotator.match(text, compiled, {
        matchWhole: true,
        populateResult: false,
        fullyAnnotate: false,
      });
      allMatch = allMatch && result.matching;

      const spans = new Set<string>();
      for (const annotation of annotator.store.ofType(condition)) {
        spans.add(`${annotation.start}:${annotation.end}`);
      }

      if (candidate === null) {
        candidate = spans;
      } else {
        for (const span of candidate) {
          if (!spans.has(span)) {
            candidate.delete(span);
          }
        }
      }

      if (candidate.size === 0) {
        break;
      }
    }

    const sorted = [...(candidate ?? [])]
      .map((span) => span.split(":").map(Number) as [number, number])
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    for (const [start, end] of sorted) {
      annotator.add(start, end);
    }
    return allMatch;
  }

  toString(): string {
    return `MultiRule(${JSON.stringify(this.conditions)})`;
  }
}

function multiConditions(parameter: string): string[] {
  let conditions = splitPattern(parameter);
  if (conditions.length === 1 && isRuleChunk(conditions[0])) {
    // Backwards-compatible handling of [multi:[[i:a][i:b]]]: when the single
    // chunk cannot be a rule itself, unwrap its contents.
    try {
      ruleName(conditions[0]);
    } catch (error) {
      if (!(error instanceof PatternError)) {
        throw error;
      }
      const inner = splitPattern(conditions[0].slice(1, -1));
      if (inner.length > 0) {
        conditions = inner;
      }
    }
  }
  if (conditions.length === 0) {
    throw new PatternError("The multi rule needs at least one condition");
  }
  return conditions;
}

function splitAlternatives(parameter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;

  for (let index = 0; index < parameter.length; index += 1) {
    const character = parameter[index];
    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth < 0) {
        throw new PatternError("Unbalanced brackets in the or rule");
      }
    } else if (character === "|" && depth === 0) {
      parts.push(parameter.slice(last, index));
      last = index + 1;
    }
  }
  parts.push(parameter.slice(last));

  if (parts.length === 0 || parts.some((part) => part.trim() === "")) {
    throw new PatternError("The or rule needs non-empty alternatives");
  }
  return parts.map((part) => part.trim());
}

/**
 * Union of several alternatives.
 *
 * ```text
 * [or:[i:cat]|[i:dog]]
 * [or:[i:the] [i:dog]|[i:cat]]
 * ```
 *
 * Alternatives may themselves contain `[r:a|b]`; `|` is only a separator at
 * bracket depth zero.  The rule annotates the span covered by each successful
 * alternative and records which alternatives matched.
 */
export class OrRule implements Rule {
  readonly alternatives: readonly string[];
  private readonly compiled: readonly CompiledPattern[];

  constructor(parameter: string, matcher: FlexiMatcher) {
    this.alternatives = splitAlternatives(parameter);
    this.compiled = this.alternatives.map((alternative) =>
      matcher.compile(alternative),
    );
  }

  annotate(text: string, annotator: Annotator): boolean {
    const spans = new Map<
      string,
      { start: number; end: number; alternatives: Set<string> }
    >();

    for (let index = 0; index < this.compiled.length; index += 1) {
      annotator.budget.check();
      const alternative = this.alternatives[index];
      const result = annotator.match(text, this.compiled[index], {
        matchWhole: false,
        populateResult: true,
        fullyAnnotate: false,
      });
      for (const sequence of result.interpretations ?? []) {
        if (sequence.length === 0) {
          continue;
        }
        const start = sequence[0].start;
        const end = sequence[sequence.length - 1].end;
        if (end <= start) {
          continue;
        }
        const key = `${start}:${end}`;
        let bucket = spans.get(key);
        if (bucket === undefined) {
          bucket = { start, end, alternatives: new Set() };
          spans.set(key, bucket);
        }
        bucket.alternatives.add(alternative);
      }
    }

    let whole = false;
    for (const span of spans.values()) {
      annotator.add(span.start, span.end, {
        alternatives: [...span.alternatives],
      });
      if (span.start === 0 && span.end === text.length) {
        whole = true;
      }
    }
    return whole;
  }

  toString(): string {
    return `OrRule(${JSON.stringify(this.alternatives)})`;
  }
}

export interface RepeatRuleOptions {
  /** Maximum number of repetitions to enumerate. Defaults to `16`. */
  maxRepetitions?: number;
}

/**
 * One or more contiguous repetitions of a pattern.
 *
 * The rule annotates every span reachable by chaining adjacent matches of the
 * sub-pattern, up to `maxRepetitions`.  The annotation data records the
 * repetition counts that produced the span.
 */
export class RepeatRule implements Rule {
  readonly pattern: string;
  private readonly compiled: CompiledPattern;
  private readonly maxRepetitions: number;

  constructor(
    parameter: string,
    matcher: FlexiMatcher,
    options: RepeatRuleOptions = {},
  ) {
    if (!parameter.trim()) {
      throw new RuleError("The repeat rule needs a pattern");
    }
    this.pattern = parameter;
    this.compiled = matcher.compile(parameter);
    const max = options.maxRepetitions ?? 16;
    this.maxRepetitions = Number.isInteger(max) && max > 0 ? max : 16;
  }

  annotate(text: string, annotator: Annotator): boolean {
    annotator.budget.check();
    const result = annotator.match(text, this.compiled, {
      matchWhole: false,
      populateResult: true,
      fullyAnnotate: false,
    });

    const edges = new Map<number, Set<number>>();
    for (const sequence of result.interpretations ?? []) {
      if (sequence.length === 0) {
        continue;
      }
      const start = sequence[0].start;
      const end = sequence[sequence.length - 1].end;
      if (end <= start) {
        continue;
      }
      let bucket = edges.get(start);
      if (bucket === undefined) {
        bucket = new Set();
        edges.set(start, bucket);
      }
      bucket.add(end);
    }

    const spans = new Map<
      string,
      { start: number; end: number; counts: Set<number> }
    >();

    let ticks = 0;
    const walk = (origin: number, end: number, count: number): void => {
      ticks += 1;
      if ((ticks & 255) === 0) {
        annotator.budget.check();
      }
      if (count > 0) {
        const key = `${origin}:${end}`;
        let bucket = spans.get(key);
        if (bucket === undefined) {
          bucket = { start: origin, end, counts: new Set() };
          spans.set(key, bucket);
        }
        bucket.counts.add(count);
      }
      if (count >= this.maxRepetitions) {
        return;
      }
      for (const next of edges.get(end) ?? []) {
        if (next > end) {
          walk(origin, next, count + 1);
        }
      }
    };

    for (const start of edges.keys()) {
      walk(start, start, 0);
    }

    let whole = false;
    for (const span of spans.values()) {
      annotator.add(span.start, span.end, {
        repetitions: [...span.counts].sort((left, right) => left - right),
      });
      if (span.start === 0 && span.end === text.length) {
        whole = true;
      }
    }
    return whole;
  }

  toString(): string {
    return `RepeatRule(${JSON.stringify(this.pattern)})`;
  }
}

/**
 * A pattern that may be present zero or one time.
 *
 * The rule annotates every span the inner pattern matches.  The sequence
 * matcher, not the rule, implements the zero case: a chunk whose factory sets
 * `optional: true` may be skipped, so no zero-length annotation is needed.
 *
 * ```ts
 * matcher.matches("ac", "[i:a] [optional:[i:b]] [i:c]").matching;  // true
 * matcher.matches("abc", "[i:a] [optional:[i:b]] [i:c]").matching; // true
 * ```
 */
export class OptionalRule implements Rule {
  readonly pattern: string;
  private readonly compiled: CompiledPattern;

  constructor(parameter: string, matcher: FlexiMatcher) {
    if (!parameter.trim()) {
      throw new RuleError("The optional rule needs a pattern");
    }
    this.pattern = parameter;
    this.compiled = matcher.compile(parameter);
  }

  annotate(text: string, annotator: Annotator): boolean {
    annotator.budget.check();
    const result = annotator.match(text, this.compiled, {
      matchWhole: false,
      populateResult: true,
      fullyAnnotate: false,
    });

    const spans = new Map<string, [number, number]>();
    for (const sequence of result.interpretations ?? []) {
      if (sequence.length === 0) {
        continue;
      }
      const start = sequence[0]!.start;
      const end = sequence[sequence.length - 1]!.end;
      if (end <= start) {
        continue;
      }
      spans.set(`${start}:${end}`, [start, end]);
    }
    for (const [start, end] of spans.values()) {
      annotator.add(start, end);
    }
    return false;
  }

  toString(): string {
    return `OptionalRule(${JSON.stringify(this.pattern)})`;
  }
}

/** One or more whitespace characters, annotated as one span. */
export class WhitespaceRule implements Rule {
  annotate(text: string, annotator: Annotator): boolean {
    const pattern = /\s+/gu;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      annotator.add(start, start + match[0].length);
    }
    return text.length > 0 && text.trim().length === 0;
  }

  toString(): string {
    return "WhitespaceRule()";
  }
}

const WORD_RUN =
  /\p{L}[\p{L}\p{M}]*(?:['\u2018\u2019\u02bc][\p{L}\p{M}]*)*'?/gu;
const WORD_APOSTROPHES = new Set(["'", "\u2018", "\u2019", "\u02bc"]);

function normalizeWord(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .trim()
    .toLowerCase();
}

/**
 * A whole-word, case-insensitive literal.
 *
 * Unlike `[i:text]`, which matches any substring, `[word:text]` compares
 * Unicode word tokens, so `[word:non]` does not match inside *nonostante*.
 * Italian elisions are exposed both as the whole run and as their
 * apostrophe-separated pieces, matching the Wiktionary tokenizer.
 */
export class WordRule implements Rule {
  readonly text: string;
  private readonly target: string;

  constructor(text: string) {
    if (!text) {
      throw new RuleError("A word rule cannot be empty");
    }
    if (/\s/.test(text)) {
      throw new RuleError(
        `A word rule expects a single word, got ${JSON.stringify(text)}`,
      );
    }
    if (!/\p{L}/u.test(text)) {
      throw new RuleError(
        `A word rule expects at least one letter, got ${JSON.stringify(text)}`,
      );
    }
    this.text = text;
    this.target = normalizeWord(text);
  }

  annotate(text: string, annotator: Annotator): boolean {
    let whole = false;
    for (const match of text.matchAll(WORD_RUN)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;

      const candidates: Array<[number, number]> = [[start, end]];
      let segmentStart = start;
      for (let index = start; index < end; index += 1) {
        if (WORD_APOSTROPHES.has(text[index]!)) {
          candidates.push([segmentStart, index + 1]);
          segmentStart = index + 1;
        }
      }
      if (segmentStart < end) {
        candidates.push([segmentStart, end]);
      }

      const seen = new Set<string>();
      for (const [candidateStart, candidateEnd] of candidates) {
        if (candidateEnd <= candidateStart) {
          continue;
        }
        const key = `${candidateStart}:${candidateEnd}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        if (
          normalizeWord(text.slice(candidateStart, candidateEnd)) !==
          this.target
        ) {
          continue;
        }
        annotator.add(candidateStart, candidateEnd);
        if (candidateStart === 0 && candidateEnd === text.length) {
          whole = true;
        }
      }
    }
    return whole;
  }

  toString(): string {
    return `WordRule(${JSON.stringify(this.text)})`;
  }
}

export interface RegexRuleFactoryOptions {
  /** Flags passed to `RegExp`; `g` and `y` are ignored. Defaults to `"u"`. */
  flags?: string;
  /** Maximum span length to consider; 0 means unlimited. */
  maxSpan?: number;
}

/** Factory for the built-in `r` rule. */
export class RegexRuleFactory implements RuleFactory {
  private readonly cache = new Map<string, RegexRule>();
  private readonly flags: string;
  private readonly maxSpan: number;

  constructor(options: RegexRuleFactoryOptions = {}) {
    this.flags = options.flags ?? "u";
    this.maxSpan = options.maxSpan ?? 0;
  }

  getRule(parameter: string): RegexRule {
    if (!parameter) {
      throw new RuleError(
        "Cannot create a regex annotator with an empty pattern",
      );
    }
    let rule = this.cache.get(parameter);
    if (rule === undefined) {
      rule = new RegexRule(parameter, this.flags, this.maxSpan);
      this.cache.set(parameter, rule);
    }
    return rule;
  }

  generateSample(): null {
    return null;
  }
}

export interface InsensitiveCaseRuleFactoryOptions {
  /** Flags passed to `RegExp`; `g` and `y` are ignored. Defaults to `"u"`. */
  flags?: string;
  /** Maximum span length to consider; 0 means unlimited. */
  maxSpan?: number;
}

/** Factory for the built-in `i` rule. */
export class InsensitiveCaseRuleFactory implements RuleFactory {
  private readonly cache = new Map<string, InsensitiveCaseRule>();
  private readonly flags: string;
  private readonly maxSpan: number;

  constructor(options: InsensitiveCaseRuleFactoryOptions = {}) {
    this.flags = options.flags ?? "u";
    this.maxSpan = options.maxSpan ?? 0;
  }

  getRule(parameter: string): InsensitiveCaseRule {
    if (!parameter) {
      throw new RuleError(
        "Cannot create a case-insensitive annotator with an empty pattern",
      );
    }
    let rule = this.cache.get(parameter);
    if (rule === undefined) {
      rule = new InsensitiveCaseRule(parameter, this.flags, this.maxSpan);
      this.cache.set(parameter, rule);
    }
    return rule;
  }

  generateSample(parameter: string): string {
    const choice = Math.random();
    if (choice < 0.3) {
      return parameter.toUpperCase();
    }
    if (choice < 0.6) {
      return parameter.toLowerCase();
    }
    return Array.from(parameter)
      .map((character) =>
        Math.random() < 0.5 ? character.toUpperCase() : character.toLowerCase(),
      )
      .join("");
  }
}

/** Factory for the built-in `multi` rule. */
export class MultiRuleFactory implements RuleFactory {
  private readonly matcher: FlexiMatcher;

  constructor(matcher: FlexiMatcher) {
    this.matcher = matcher;
  }

  getRule(parameter: string): MultiRule {
    return new MultiRule(parameter, this.matcher);
  }

  generateSample(): null {
    return null;
  }
}

/** Factory for the built-in `or` rule. */
export class OrRuleFactory implements RuleFactory {
  private readonly matcher: FlexiMatcher;

  constructor(matcher: FlexiMatcher) {
    this.matcher = matcher;
  }

  getRule(parameter: string): OrRule {
    return new OrRule(parameter, this.matcher);
  }

  generateSample(parameter: string): string | null {
    const alternatives = splitAlternatives(parameter);
    const alternative =
      alternatives[Math.floor(Math.random() * alternatives.length)];
    return this.matcher.generateSample(alternative);
  }
}

/** Factory for the built-in `repeat` rule. */
export class RepeatRuleFactory implements RuleFactory {
  private readonly matcher: FlexiMatcher;
  private readonly options: RepeatRuleOptions;

  constructor(matcher: FlexiMatcher, options: RepeatRuleOptions = {}) {
    this.matcher = matcher;
    this.options = options;
  }

  getRule(parameter: string): RepeatRule {
    return new RepeatRule(parameter, this.matcher, this.options);
  }

  generateSample(parameter: string): string | null {
    const sample = this.matcher.generateSample(parameter);
    return sample === null ? null : `${sample}${sample}`;
  }
}

/** Factory for the built-in `optional` combinator. */
export class OptionalRuleFactory implements RuleFactory {
  readonly optional = true;
  private readonly matcher: FlexiMatcher;

  constructor(matcher: FlexiMatcher) {
    this.matcher = matcher;
  }

  getRule(parameter: string): OptionalRule {
    return new OptionalRule(parameter, this.matcher);
  }

  generateSample(parameter: string): string | null {
    return this.matcher.generateSample(parameter);
  }
}

/** Factory for the built-in `ws` rule. */
export class WhitespaceRuleFactory implements RuleFactory {
  private readonly rule = new WhitespaceRule();

  getRule(): WhitespaceRule {
    return this.rule;
  }

  generateSample(): string {
    return " ";
  }
}

/** Factory for the built-in `word` rule. */
export class WordRuleFactory implements RuleFactory {
  private readonly cache = new Map<string, WordRule>();

  getRule(parameter: string): WordRule {
    let rule = this.cache.get(parameter);
    if (rule === undefined) {
      rule = new WordRule(parameter);
      this.cache.set(parameter, rule);
    }
    return rule;
  }

  generateSample(parameter: string): string {
    return parameter;
  }
}

/**
 * Factory for the built-in `char` rule.
 *
 * The parameter is a Unicode code point written in decimal (`98`) or with a
 * `0x` prefix (`0x62`).  JavaScript strings are sequences of UTF-16 code units,
 * so an astral character is annotated as two units, exactly as `String#slice`
 * sees it.
 */
export class SingleCharRuleFactory implements RuleFactory {
  getRule(parameter: string): PlainTextRule {
    return new PlainTextRule(parseCodePoint(parameter));
  }

  generateSample(parameter: string): string {
    return parseCodePoint(parameter);
  }
}

function parseCodePoint(parameter: string): string {
  const trimmed = parameter.trim();
  if (!trimmed) {
    throw new RuleError(
      "Cannot create a character annotator with an empty pattern",
    );
  }

  let codePoint: number;
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    codePoint = Number.parseInt(trimmed.slice(2), 16);
  } else if (/^[0-9]+$/.test(trimmed)) {
    codePoint = Number.parseInt(trimmed, 10);
  } else {
    throw new RuleError(
      `The char rule expects a decimal or 0x-prefixed code point, got ${JSON.stringify(parameter)}`,
    );
  }

  if (
    !Number.isInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    throw new RuleError(`Invalid Unicode code point ${codePoint}`);
  }
  return String.fromCodePoint(codePoint);
}
