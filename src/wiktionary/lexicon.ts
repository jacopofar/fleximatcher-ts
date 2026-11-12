/**
 * A compact, in-memory Wiktionary lexicon indexed by surface word.
 *
 * The Node-only loader in `load.ts` streams the generated NDJSON artifact into
 * this structure; browser code can build one directly with `fromData` or
 * `fromEntries`.
 */

import {
  normalizeFeature,
  normalizePerson,
  normalizePos,
  normalizeWordKey,
} from "./normalize.js";

export interface WiktionaryEntry {
  /** Surface form as recorded in the lexicon. */
  readonly word: string;
  /** Canonical lemma this form belongs to. */
  readonly lemma: string;
  /** Normalized part of speech, e.g. `noun`, `verb`, `adj`. */
  readonly pos: string;
  /** Normalized inflection/derivation features. */
  readonly features: readonly string[];
  readonly gender?: string;
  readonly number?: string;
  readonly case?: string;
  readonly person?: string;
  readonly mood?: string;
  readonly tense?: string;
  readonly verbForm?: string;
  /** Declension or conjugation class, e.g. `it-noun:f` or `it-verb:a/@`. */
  readonly declension?: string;
}

/** Compact entry shape used by the generated NDJSON artifact. */
export interface CompactWiktionaryEntry {
  /** word */
  w: string;
  /** lemma */
  l: string;
  /** pos */
  p: string;
  /** features */
  f?: string[];
  /** declension */
  d?: string;
}

/** Readable entry shape accepted by `fromData`. */
export interface FullWiktionaryEntryInput {
  word: string;
  lemma?: string;
  pos: string;
  features?: string[];
  declension?: string;
}

export type WiktionaryEntryInput =
  | CompactWiktionaryEntry
  | FullWiktionaryEntryInput;

export interface WiktionaryLexiconData {
  format?: string;
  version?: number;
  language: string;
  languageName?: string;
  generatedAt?: string;
  words: Record<string, WiktionaryEntryInput[]>;
}

const MOODS = [
  "indicative",
  "subjunctive",
  "imperative",
  "conditional",
] as const;
const TENSES = ["present", "imperfect", "future", "past", "historic"] as const;
const VERB_FORMS = ["infinitive", "gerund", "participle"] as const;
const CASES = [
  "nominative",
  "genitive",
  "dative",
  "accusative",
  "ablative",
  "vocative",
  "locative",
  "instrumental",
  "partitive",
  "prepositional",
  "oblique",
] as const;

function firstFeature(
  features: readonly string[],
  candidates: readonly string[],
): string | undefined {
  for (const candidate of candidates) {
    if (features.includes(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function deriveGender(features: readonly string[]): string | undefined {
  if (features.includes("by-personal-gender")) {
    return "mf";
  }
  const masculine = features.includes("masculine");
  const feminine = features.includes("feminine");
  if (masculine && feminine) {
    return "mf";
  }
  if (masculine) {
    return "m";
  }
  if (feminine) {
    return "f";
  }
  return undefined;
}

function deriveNumber(features: readonly string[]): string | undefined {
  const singular = features.includes("singular");
  const plural = features.includes("plural");
  if (singular && plural) {
    return "sp";
  }
  if (plural) {
    return "p";
  }
  if (singular) {
    return "s";
  }
  return undefined;
}

export function createWiktionaryEntry(
  raw: WiktionaryEntryInput,
  fallbackWord = "",
): WiktionaryEntry {
  const compact = "w" in raw;
  const word = compact ? raw.w : raw.word;
  const lemma = compact ? raw.l : (raw.lemma ?? word);
  const pos = compact ? raw.p : raw.pos;
  const rawFeatures = compact ? (raw.f ?? []) : (raw.features ?? []);
  const declension = compact ? raw.d : raw.declension;

  const resolvedWord = word || fallbackWord;
  if (!resolvedWord) {
    throw new TypeError("A Wiktionary lexicon entry needs a word");
  }
  if (!pos) {
    throw new TypeError(
      `A Wiktionary lexicon entry for ${JSON.stringify(resolvedWord)} needs a pos`,
    );
  }

  const features = [...new Set(rawFeatures.map(normalizeFeature))].sort();
  return {
    word: resolvedWord,
    lemma: lemma || resolvedWord,
    pos: normalizePos(pos),
    features,
    gender: deriveGender(features),
    number: deriveNumber(features),
    case: firstFeature(features, CASES),
    person: normalizePerson(
      firstFeature(features, [
        "first-person",
        "second-person",
        "third-person",
      ]) ?? "",
    ),
    mood: firstFeature(features, MOODS),
    tense: firstFeature(features, TENSES),
    verbForm: firstFeature(features, VERB_FORMS),
    declension,
  };
}

export interface WiktionaryLexiconLoadOptions {
  /** Keep only these parts of speech, e.g. `["noun", "adj", "verb"]`. */
  pos?: string | readonly string[];
}

function asPosFilter(
  pos: string | readonly string[] | undefined,
): Set<string> | null {
  if (pos === undefined) {
    return null;
  }
  const values = typeof pos === "string" ? [pos] : pos;
  return new Set(values.map(normalizePos));
}

/** A word-indexed collection of Wiktionary entries. */
export class WiktionaryLexicon {
  private languageValue: string;
  private languageNameValue: string | undefined;
  private readonly posFilter: Set<string> | null;
  private readonly words = new Map<string, WiktionaryEntry[]>();
  private index = new Map<string, Map<string, WiktionaryEntry>>();
  private readonly flat: WiktionaryEntry[] = [];
  private sealed = false;

  private constructor(
    language: string,
    languageName?: string,
    posFilter: Set<string> | null = null,
  ) {
    this.languageValue = language;
    this.languageNameValue = languageName;
    this.posFilter = posFilter;
  }

  /** The language code of the lexicon, e.g. `it`. */
  get language(): string {
    return this.languageValue;
  }

  /** A human-readable language name, when the artifact provides one. */
  get languageName(): string | undefined {
    return this.languageNameValue;
  }

  /** Number of distinct surface-word keys. */
  get wordCount(): number {
    return this.words.size;
  }

  /** Number of entries (a word may have several homographs/pos). */
  get entryCount(): number {
    return this.flat.length;
  }

  /** Entries for `word`, case- and apostrophe-insensitive. */
  lookup(word: string): readonly WiktionaryEntry[] {
    return this.words.get(normalizeWordKey(word)) ?? [];
  }

  /** Iterate over every entry. */
  *entries(): IterableIterator<WiktionaryEntry> {
    yield* this.flat;
  }

  /**
   * Pick a random entry satisfying `predicate`.
   *
   * This is used for sample generation; it gives up after `attempts` random
   * probes rather than scanning a potentially huge lexicon.
   */
  sample(
    predicate: (entry: WiktionaryEntry) => boolean,
    attempts = 2000,
  ): WiktionaryEntry | undefined {
    if (this.flat.length === 0) {
      return undefined;
    }
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const entry = this.flat[Math.floor(Math.random() * this.flat.length)];
      if (predicate(entry)) {
        return entry;
      }
    }
    // Sparse queries can miss in the random probes; sample generation is not
    // hot, so fall back to a deterministic scan.
    for (const entry of this.flat) {
      if (predicate(entry)) {
        return entry;
      }
    }
    return undefined;
  }

  /** Create an empty lexicon (mainly for the streaming loader). */
  static empty(
    language = "und",
    languageName?: string,
    pos?: string | readonly string[],
  ): WiktionaryLexicon {
    return new WiktionaryLexicon(language, languageName, asPosFilter(pos));
  }

  /** Build a lexicon from the JSON object format. */
  static fromData(
    data: WiktionaryLexiconData,
    options: WiktionaryLexiconLoadOptions = {},
  ): WiktionaryLexicon {
    const lexicon = new WiktionaryLexicon(
      data.language ?? "und",
      data.languageName,
      asPosFilter(options.pos),
    );
    for (const [key, entries] of Object.entries(data.words ?? {})) {
      for (const raw of entries) {
        lexicon.add(createWiktionaryEntry(raw, key));
      }
    }
    lexicon.seal();
    return lexicon;
  }

  /** Build a lexicon from an array of entries. */
  static fromEntries(
    entries: readonly WiktionaryEntryInput[],
    options: WiktionaryLexiconLoadOptions & {
      language?: string;
      languageName?: string;
    } = {},
  ): WiktionaryLexicon {
    const lexicon = new WiktionaryLexicon(
      options.language ?? "und",
      options.languageName,
      asPosFilter(options.pos),
    );
    for (const raw of entries) {
      lexicon.add(createWiktionaryEntry(raw));
    }
    lexicon.seal();
    return lexicon;
  }

  /**
   * Load a lexicon from `.json`, `.json.gz`, `.jsonl`, `.jsonl.gz`,
   * `.ndjson` or `.ndjson.gz`.
   *
   * This method lives in the Node-only loader; browser code uses
   * `WiktionaryLexicon.fromData` or `fromEntries` instead.
   */

  /** @internal */
  setMetadata(language: string, languageName?: string): void {
    this.languageValue = language;
    if (languageName !== undefined) {
      this.languageNameValue = languageName;
    }
  }

  /** @internal */
  add(entry: WiktionaryEntry): void {
    if (this.sealed) {
      throw new Error("This WiktionaryLexicon is already sealed");
    }
    if (this.posFilter !== null && !this.posFilter.has(entry.pos)) {
      return;
    }
    const wordKey = normalizeWordKey(entry.word);
    let bucket = this.words.get(wordKey);
    let index = this.index.get(wordKey);
    if (bucket === undefined || index === undefined) {
      bucket = [];
      index = new Map();
      this.words.set(wordKey, bucket);
      this.index.set(wordKey, index);
    }

    const entryKey = `${entry.pos}\u0000${normalizeWordKey(entry.lemma)}\u0000${entry.features.join("\u0001")}`;
    const existing = index.get(entryKey);
    if (existing !== undefined) {
      if (existing.declension === undefined && entry.declension !== undefined) {
        (existing as { declension?: string }).declension = entry.declension;
      }
      return;
    }

    index.set(entryKey, entry);
    bucket.push(entry);
    this.flat.push(entry);
  }

  /** @internal */
  seal(): void {
    this.sealed = true;
    this.index.clear();
  }

  toString(): string {
    return `WiktionaryLexicon(${this.language}, ${this.wordCount} words, ${this.entryCount} entries)`;
  }
}
