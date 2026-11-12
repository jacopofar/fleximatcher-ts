/**
 * Wiktionary-backed annotators for fleximatcher.
 */

import type { AnnotationStore, Annotator } from "../annotations.js";
import type { FlexiMatcher } from "../matcher.js";
import type { Rule, RuleFactory } from "../rules.js";
import type { WiktionaryEntry, WiktionaryLexicon } from "./lexicon.js";
import { normalizePos } from "./normalize.js";
import {
  entryMatchesQuery,
  parseWiktionaryQuery,
  type WiktionaryQuery,
} from "./query.js";
import { tokenizeWords, type WordToken } from "./tokenize.js";

export interface WiktionaryRuleOptions {
  /** POS (or POS list) this rule accepts, e.g. `noun` or `["noun", "name"]`. */
  pos: string | readonly string[];
  /** Query appended to every rule parameter. */
  defaultQuery?: string;
}

function asPosSet(pos: string | readonly string[]): Set<string> {
  const values = typeof pos === "string" ? [pos] : pos;
  return new Set(values.map(normalizePos));
}

interface WiktionaryTokenCache {
  text: string;
  tokens: readonly WordToken[];
}

function tokensFor(store: AnnotationStore, text: string): readonly WordToken[] {
  const cached = store.extras.get("wiktionary_tokens");
  if (
    cached !== null &&
    typeof cached === "object" &&
    "text" in cached &&
    "tokens" in cached
  ) {
    const value = cached as WiktionaryTokenCache;
    if (value.text === text) {
      return value.tokens;
    }
  }
  const tokens = tokenizeWords(text);
  store.extras.set("wiktionary_tokens", {
    text,
    tokens,
  } satisfies WiktionaryTokenCache);
  return tokens;
}

function annotationData(
  entry: WiktionaryEntry,
  language: string,
  covered: string,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    source: "wiktionary",
    language,
    word: covered,
    canonical: entry.word,
    lemma: entry.lemma,
    pos: entry.pos,
    features: entry.features,
  };
  if (entry.gender !== undefined) {
    data.gender = entry.gender;
  }
  if (entry.number !== undefined) {
    data.number = entry.number;
  }
  if (entry.case !== undefined) {
    data.case = entry.case;
  }
  if (entry.person !== undefined) {
    data.person = entry.person;
  }
  if (entry.mood !== undefined) {
    data.mood = entry.mood;
  }
  if (entry.tense !== undefined) {
    data.tense = entry.tense;
  }
  if (entry.verbForm !== undefined) {
    data.verbForm = entry.verbForm;
  }
  if (entry.declension !== undefined) {
    data.declension = entry.declension;
  }
  return data;
}

/**
 * A rule that annotates matched word tokens with lexicon entries.
 *
 * The tokenizer emits whole word runs and apostrophe-separated pieces, so
 * `dell'acqua` is looked up as `dell'` and `acqua`.
 */
export class WiktionaryRule implements Rule {
  readonly lexicon: WiktionaryLexicon;
  readonly pos: ReadonlySet<string>;
  readonly queries: readonly WiktionaryQuery[];

  constructor(
    lexicon: WiktionaryLexicon,
    pos: ReadonlySet<string>,
    queries: readonly WiktionaryQuery[],
  ) {
    this.lexicon = lexicon;
    this.pos = pos;
    this.queries = queries;
  }

  matchesEntry(entry: WiktionaryEntry): boolean {
    if (this.pos.size > 0 && !this.pos.has(entry.pos)) {
      return false;
    }
    return this.queries.every((query) => entryMatchesQuery(entry, query));
  }

  annotate(text: string, annotator: Annotator): boolean {
    let whole = false;
    for (const token of tokensFor(annotator.store, text)) {
      for (const entry of this.lexicon.lookup(token.text)) {
        if (!this.matchesEntry(entry)) {
          continue;
        }
        annotator.add(
          token.start,
          token.end,
          annotationData(entry, this.lexicon.language, token.text),
        );
        if (token.start === 0 && token.end === text.length) {
          whole = true;
        }
      }
    }
    return whole;
  }

  toString(): string {
    return `WiktionaryRule(${this.lexicon.language}, pos=${[...this.pos].join("|") || "any"})`;
  }
}

/** Create rules over a lexicon. */
export class WiktionaryRuleFactory implements RuleFactory {
  readonly lexicon: WiktionaryLexicon;
  private readonly pos: Set<string>;
  private readonly defaultQueries: readonly WiktionaryQuery[];
  private readonly cache = new Map<string, WiktionaryRule>();

  constructor(lexicon: WiktionaryLexicon, options: WiktionaryRuleOptions) {
    if (options.pos === undefined) {
      throw new TypeError("WiktionaryRuleFactory needs a pos option");
    }
    this.lexicon = lexicon;
    this.pos = asPosSet(options.pos);
    this.defaultQueries =
      options.defaultQuery === undefined || options.defaultQuery.trim() === ""
        ? []
        : [parseWiktionaryQuery(options.defaultQuery)];
  }

  private queriesFor(parameter: string): WiktionaryQuery[] {
    const queries = [...this.defaultQueries];
    if (parameter.trim() !== "") {
      queries.push(parseWiktionaryQuery(parameter));
    }
    return queries;
  }

  getRule(parameter: string): WiktionaryRule {
    const cached = this.cache.get(parameter);
    if (cached !== undefined) {
      return cached;
    }
    const rule = new WiktionaryRule(
      this.lexicon,
      this.pos,
      this.queriesFor(parameter),
    );
    this.cache.set(parameter, rule);
    return rule;
  }

  generateSample(parameter: string): string | null {
    const queries = this.queriesFor(parameter);
    const entry = this.lexicon.sample((candidate) => {
      if (this.pos.size > 0 && !this.pos.has(candidate.pos)) {
        return false;
      }
      return queries.every((query) => entryMatchesQuery(candidate, query));
    });
    return entry?.word ?? null;
  }
}

const DEFAULT_POS_RULES: Record<string, readonly string[]> = {
  noun: ["noun"],
  name: ["name"],
  adj: ["adj"],
  verb: ["verb"],
  adv: ["adv"],
  pron: ["pron"],
  det: ["det"],
  article: ["article"],
  prep: ["prep"],
  conj: ["conj"],
  intj: ["intj"],
  num: ["num"],
  particle: ["particle"],
  contraction: ["contraction"],
};

export interface RegisterWiktionaryOptions {
  /**
   * Rule-name prefix.  Defaults to the lexicon language, so an Italian
   * lexicon gets `it-noun`, `it-verb`, etc.
   */
  prefix?: string;
  /** Extra or overriding POS bindings, keyed by rule suffix. */
  pos?: Record<string, string | readonly string[]>;
  /** Bind the default POS set.  Defaults to true. */
  includeDefaults?: boolean;
  /** Query appended to every rule parameter. */
  defaultQuery?: string;
}

/**
 * Bind a standard set of POS annotators on `matcher`.
 *
 * ```ts
 * registerWiktionaryRules(matcher, lexicon, { prefix: "it" });
 * matcher.matches("una casa", "una [it-noun:feminine singular]");
 * ```
 */
export function registerWiktionaryRules(
  matcher: FlexiMatcher,
  lexicon: WiktionaryLexicon,
  options: RegisterWiktionaryOptions = {},
): void {
  const prefix = options.prefix ?? lexicon.language;
  const bindings: Record<string, string | readonly string[]> = {
    ...(options.includeDefaults === false ? {} : DEFAULT_POS_RULES),
    ...(options.pos ?? {}),
  };

  for (const [suffix, pos] of Object.entries(bindings)) {
    const name = prefix ? `${prefix}-${suffix}` : suffix;
    matcher.bind(
      name,
      new WiktionaryRuleFactory(lexicon, {
        pos,
        defaultQuery: options.defaultQuery,
      }),
    );
  }
}
