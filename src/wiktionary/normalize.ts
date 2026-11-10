/**
 * Normalization helpers shared by the Wiktionary lexicon builder and runtime.
 */

const APOSTROPHES = /[\u2018\u2019\u02bc]/g;

/** Normalize a surface word for lexicon lookup. */
export function normalizeWordKey(word: string): string {
  return word.normalize("NFC").replace(APOSTROPHES, "'").trim().toLowerCase();
}

/** Normalize a Wiktionary tag/feature to lower-case kebab-case. */
export function normalizeFeature(feature: string): string {
  return feature
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

const POS_ALIASES: Record<string, string> = {
  adjective: "adj",
  adverb: "adv",
  article: "article",
  character: "character",
  conjunction: "conj",
  contraction: "contraction",
  determiner: "det",
  interfix: "interfix",
  interjection: "intj",
  name: "name",
  noun: "noun",
  numeral: "num",
  particle: "particle",
  phrase: "phrase",
  prefix: "prefix",
  preposition: "prep",
  "prepositional phrase": "prep_phrase",
  pronoun: "pron",
  "proper noun": "name",
  "proper-noun": "name",
  proverb: "proverb",
  punct: "punct",
  symbol: "symbol",
  suffix: "suffix",
  verb: "verb",
  "past participle": "verb",
  "present participle": "verb",
  gerund: "verb",
  participle: "verb",
};

/** Normalize a wiktextract `pos` value. */
export function normalizePos(pos: string): string {
  let normalized = pos.normalize("NFC").trim().toLowerCase();
  normalized = normalized.replace(/\s+forms?$/, "");
  normalized = normalized.replace(/\s+/g, " ").trim();
  return POS_ALIASES[normalized] ?? normalized.replace(/\s+/g, "_");
}

/** Normalize a gender code or word to `m`, `f` or `mf`. */
export function normalizeGender(value: string): string | undefined {
  const normalized = value.normalize("NFC").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("mf") || (normalized.includes("m") && normalized.includes("f"))) {
    return "mf";
  }
  if (normalized.includes("m")) {
    return "m";
  }
  if (normalized.includes("f")) {
    return "f";
  }
  return undefined;
}

/** Normalize a number code or word to `s` or `p`. */
export function normalizeNumber(value: string): string | undefined {
  const normalized = value.normalize("NFC").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("plural") || /(^|-)p($|-)/.test(normalized)) {
    return "p";
  }
  if (normalized.includes("singular") || /(^|-)s($|-)/.test(normalized)) {
    return "s";
  }
  return undefined;
}

/** Normalize a person code or word to `1`, `2` or `3`. */
export function normalizePerson(value: string): string | undefined {
  const normalized = value.normalize("NFC").trim().toLowerCase();
  if (normalized === "1" || normalized.includes("first-person")) {
    return "1";
  }
  if (normalized === "2" || normalized.includes("second-person")) {
    return "2";
  }
  if (normalized === "3" || normalized.includes("third-person")) {
    return "3";
  }
  return undefined;
}
