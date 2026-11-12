/**
 * A small feature-query language for Wiktionary annotators.
 *
 * Rule parameters are whitespace- or comma-separated tokens:
 *
 * - `feminine`, `plural`, `third-person`, `past`, `!derived` — required or
 *   excluded feature tags;
 * - `gender=f`, `number=p`, `person=3`, `mood=indicative`, `tense=present`,
 *   `verbForm=participle`, `declension=it-noun:f`, `pos=noun`, `lemma=casa` —
 *   structured field checks;
 * - `gender=m|f` — alternatives inside one field;
 * - `feature=plural` — explicit feature check.
 */

import { PatternError } from "../errors.js";
import type { WiktionaryEntry } from "./lexicon.js";
import {
  normalizeFeature,
  normalizeGender,
  normalizeNumber,
  normalizePerson,
  normalizePos,
  normalizeWordKey,
} from "./normalize.js";

export interface WiktionaryQuery {
  readonly features: readonly string[];
  readonly excludedFeatures: readonly string[];
  readonly fields: Readonly<Record<string, readonly string[]>>;
  readonly excludedFields: Readonly<Record<string, readonly string[]>>;
}

const FIELD_ALIASES: Record<string, string> = {
  g: "gender",
  gen: "gender",
  num: "number",
  pers: "person",
  vform: "verbForm",
  "verb-form": "verbForm",
  verbform: "verbForm",
  form: "verbForm",
  decl: "declension",
  pos: "pos",
  lemma: "lemma",
  feature: "feature",
};

const ALLOWED_FIELDS = new Set([
  "gender",
  "number",
  "case",
  "person",
  "mood",
  "tense",
  "verbForm",
  "declension",
  "pos",
  "lemma",
  "feature",
]);

function normalizeField(key: string): string {
  const lowered = key.trim().toLowerCase().replace(/_/g, "-");
  return FIELD_ALIASES[lowered] ?? lowered;
}

function normalizeFieldValue(field: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new PatternError(
      `Empty value for Wiktionary query field ${JSON.stringify(field)}`,
    );
  }

  switch (field) {
    case "gender": {
      const normalized = normalizeGender(trimmed);
      if (normalized === undefined) {
        throw new PatternError(
          `Invalid gender ${JSON.stringify(value)}; use m, f or mf`,
        );
      }
      return normalized;
    }
    case "number": {
      const normalized = normalizeNumber(trimmed);
      if (normalized === undefined) {
        throw new PatternError(
          `Invalid number ${JSON.stringify(value)}; use s or p`,
        );
      }
      return normalized;
    }
    case "person": {
      const normalized = normalizePerson(trimmed);
      if (normalized === undefined) {
        throw new PatternError(
          `Invalid person ${JSON.stringify(value)}; use 1, 2 or 3`,
        );
      }
      return normalized;
    }
    case "pos":
      return normalizePos(trimmed);
    case "lemma":
      return normalizeWordKey(trimmed);
    case "declension":
      return trimmed.toLowerCase();
    case "case":
    case "mood":
    case "tense":
    case "verbForm":
    case "feature":
      return normalizeFeature(trimmed);
    default:
      return trimmed.toLowerCase();
  }
}

/** Parse a rule parameter into a query. */
export function parseWiktionaryQuery(parameter: string): WiktionaryQuery {
  const features = new Set<string>();
  const excludedFeatures = new Set<string>();
  const fields: Record<string, Set<string>> = {};
  const excludedFields: Record<string, Set<string>> = {};

  for (const rawToken of parameter.trim().split(/[\s,]+/)) {
    if (!rawToken) {
      continue;
    }

    let token = rawToken;
    let excluded = false;
    if (token.startsWith("!")) {
      excluded = true;
      token = token.slice(1);
    }
    if (!token) {
      throw new PatternError(
        `Empty Wiktionary query token ${JSON.stringify(rawToken)}`,
      );
    }

    const equals = token.indexOf("=");
    if (equals === -1) {
      const feature = normalizeFeature(token);
      (excluded ? excludedFeatures : features).add(feature);
      continue;
    }

    const field = normalizeField(token.slice(0, equals));
    if (!ALLOWED_FIELDS.has(field)) {
      throw new PatternError(
        `Unknown Wiktionary query field ${JSON.stringify(token.slice(0, equals))}`,
      );
    }
    const values = token.slice(equals + 1).split("|");
    const target = excluded ? excludedFields : fields;
    const bucket = target[field] ?? new Set<string>();
    for (const value of values) {
      bucket.add(normalizeFieldValue(field, value));
    }
    target[field] = bucket;
  }

  const freezeFields = (
    source: Record<string, Set<string>>,
  ): Record<string, readonly string[]> =>
    Object.fromEntries(
      Object.entries(source).map(([key, values]) => [key, [...values]]),
    );

  return {
    features: [...features],
    excludedFeatures: [...excludedFeatures],
    fields: freezeFields(fields),
    excludedFields: freezeFields(excludedFields),
  };
}

function fieldMatches(
  entry: WiktionaryEntry,
  field: string,
  value: string,
): boolean {
  switch (field) {
    case "feature":
      return entry.features.includes(value);
    case "gender":
      if (value === "m" || value === "f") {
        return entry.gender === value || entry.gender === "mf";
      }
      return entry.gender === value;
    case "number":
      if (entry.number === "sp") {
        return value === "s" || value === "p";
      }
      return entry.number === value;
    case "case":
      return entry.case === value;
    case "person":
      return entry.person === value;
    case "mood":
      return entry.mood === value;
    case "tense":
      return entry.tense === value;
    case "verbForm":
      return entry.verbForm === value;
    case "declension":
      return (entry.declension ?? "").toLowerCase() === value;
    case "pos":
      return entry.pos === value;
    case "lemma":
      return normalizeWordKey(entry.lemma) === value;
    default:
      return false;
  }
}

/** Whether an entry satisfies a parsed query. */
export function entryMatchesQuery(
  entry: WiktionaryEntry,
  query: WiktionaryQuery,
): boolean {
  for (const feature of query.features) {
    if (!entry.features.includes(feature)) {
      return false;
    }
  }
  for (const feature of query.excludedFeatures) {
    if (entry.features.includes(feature)) {
      return false;
    }
  }
  for (const [field, values] of Object.entries(query.fields)) {
    if (!values.some((value) => fieldMatches(entry, field, value))) {
      return false;
    }
  }
  for (const [field, values] of Object.entries(query.excludedFields)) {
    if (values.some((value) => fieldMatches(entry, field, value))) {
      return false;
    }
  }
  return true;
}
