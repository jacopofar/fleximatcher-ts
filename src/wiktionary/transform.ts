/**
 * Transform a wiktextract entry into compact lexicon entries.
 *
 * This is intentionally independent of the streaming builder so it can be
 * unit-tested with small JSON objects.
 */

import {
  normalizeFeature,
  normalizeGender,
  normalizeNumber,
  normalizePos,
  normalizeWordKey,
} from "./normalize.js";

export interface WiktextractTemplate {
  name?: string;
  args?: Record<string, unknown>;
}

export interface WiktextractForm {
  form?: string;
  tags?: string[];
  source?: string;
}

export interface WiktextractFormOf {
  word?: string;
}

export interface WiktextractSense {
  form_of?: WiktextractFormOf[];
  tags?: string[];
  glosses?: string[];
}

export interface WiktextractEntry {
  word?: string;
  lang?: string;
  lang_code?: string;
  pos?: string;
  head_templates?: WiktextractTemplate[];
  forms?: WiktextractForm[];
  senses?: WiktextractSense[];
}

/** A plain entry ready to be written to the lexicon artifact. */
export interface LexiconEntry {
  word: string;
  lemma: string;
  pos: string;
  features: string[];
  declension?: string;
}

const GENDER_FEATURES = new Set(["masculine", "feminine", "by-personal-gender"]);
const NUMBER_FEATURES = new Set(["singular", "plural"]);
const PERSON_FEATURES = new Set(["first-person", "second-person", "third-person"]);
const MOOD_FEATURES = new Set(["indicative", "subjunctive", "imperative", "conditional"]);
const VERB_FORM_FEATURES = new Set(["infinitive", "gerund", "participle"]);
const TENSE_FEATURES = new Set(["present", "imperfect", "future", "past", "historic"]);
const CASE_FEATURES = new Set([
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
]);
const MOOD_OR_FORM_FEATURES = new Set([...MOOD_FEATURES, ...VERB_FORM_FEATURES]);

const OVERRIDE_GROUPS = [
  GENDER_FEATURES,
  NUMBER_FEATURES,
  CASE_FEATURES,
  PERSON_FEATURES,
  MOOD_OR_FORM_FEATURES,
  TENSE_FEATURES,
];

/** Tags that describe inflection rather than derivation/register. */
const CORE_FEATURES = new Set([
  ...GENDER_FEATURES,
  ...NUMBER_FEATURES,
  ...CASE_FEATURES,
  ...PERSON_FEATURES,
  ...MOOD_FEATURES,
  ...VERB_FORM_FEATURES,
  ...TENSE_FEATURES,
  "second-person-semantically",
  "negative",
  "formal",
  "auxiliary",
  "transitive",
  "intransitive",
  "ambitransitive",
  "impersonal",
  "pronominal",
  "reflexive",
  "ergative",
  "canonical",
  "form-of",
  "inflected",
  "lemma",
]);

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return value === undefined || value === null ? undefined : String(value);
}

function addGender(features: Set<string>, gender: string | undefined): void {
  if (gender === "m") {
    features.add("masculine");
  } else if (gender === "f") {
    features.add("feminine");
  } else if (gender === "mf") {
    features.add("masculine");
    features.add("feminine");
  }
}

function addNumber(features: Set<string>, number: string | undefined): void {
  if (number === "s") {
    features.add("singular");
  } else if (number === "p") {
    features.add("plural");
  } else if (number === "sp") {
    features.add("singular");
    features.add("plural");
  }
}

function genderFromFeatures(features: ReadonlySet<string>): string | undefined {
  if (features.has("by-personal-gender")) {
    return "mf";
  }
  const masculine = features.has("masculine");
  const feminine = features.has("feminine");
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

function numberFromFeatures(features: ReadonlySet<string>): string | undefined {
  const singular = features.has("singular");
  const plural = features.has("plural");
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

interface HeadInfo {
  features: Set<string>;
  declension?: string;
}

function headInfo(entry: WiktextractEntry, pos: string): HeadInfo {
  const features = new Set<string>();
  const templates = entry.head_templates ?? [];
  const find = (...names: string[]): WiktextractTemplate | undefined =>
    templates.find((template) => template.name !== undefined && names.includes(template.name));

  const noun = find("it-noun");
  if (noun !== undefined) {
    const args = noun.args ?? {};
    const code = stringArg(args, "1") ?? stringArg(args, "g");
    addGender(features, normalizeGender(code ?? ""));
    return { features, declension: `it-noun:${code ?? "?"}` };
  }

  const name = find("it-proper noun", "it-proper-noun");
  if (name !== undefined) {
    const args = name.args ?? {};
    const code = stringArg(args, "1") ?? stringArg(args, "g");
    addGender(features, normalizeGender(code ?? ""));
    return { features, declension: `it-name:${code ?? "?"}` };
  }

  const adj = find("it-adj");
  if (adj !== undefined) {
    const args = adj.args ?? {};
    const code = stringArg(args, "g") ?? stringArg(args, "1");
    const gender = normalizeGender(code ?? "");
    addGender(features, gender);
    const suffix = code !== undefined && /^[mf]/.test(code) ? `:${code}` : "";
    return { features, declension: `it-adj${suffix}` };
  }

  const adjSup = find("it-adj-sup");
  if (adjSup !== undefined) {
    features.add("superlative");
    features.add("derived");
    return { features, declension: "it-adj-sup" };
  }

  const verb = find("it-verb");
  if (verb !== undefined) {
    const args = verb.args ?? {};
    features.add("infinitive");
    return { features, declension: `it-verb:${stringArg(args, "1") ?? "?"}` };
  }

  const verbRfc = find("it-verb-rfc");
  if (verbRfc !== undefined) {
    features.add("infinitive");
    return { features, declension: "it-verb-rfc" };
  }

  const pp = find("it-pp");
  if (pp !== undefined) {
    features.add("participle");
    features.add("past");
    return { features, declension: "it-pp" };
  }

  const adv = find("it-adv");
  if (adv !== undefined) {
    return { features, declension: "it-adv" };
  }

  const det = find("it-det");
  if (det !== undefined) {
    const args = det.args ?? {};
    const code = stringArg(args, "g") ?? stringArg(args, "1");
    addGender(features, normalizeGender(code ?? ""));
    addNumber(features, normalizeNumber(code ?? ""));
    return { features, declension: "it-det" };
  }

  const pronAdj = find("it-pron-adj");
  if (pronAdj !== undefined) {
    return { features, declension: "it-pron-adj" };
  }

  const posTemplate = find("it-pos");
  if (posTemplate !== undefined) {
    const args = posTemplate.args ?? {};
    return { features, declension: `it-pos:${stringArg(args, "1") ?? "?"}` };
  }

  const head = find("head");
  if (head !== undefined) {
    const args = head.args ?? {};
    const code = stringArg(args, "g");
    addGender(features, normalizeGender(code ?? ""));
    addNumber(features, normalizeNumber(code ?? ""));
    const description = (stringArg(args, "2") ?? "").toLowerCase();
    if (description.includes("participle")) {
      features.add("participle");
    }
    if (description.includes("past")) {
      features.add("past");
    }
    if (description.includes("present")) {
      features.add("present");
    }
    if (description.includes("gerund")) {
      features.add("gerund");
    }
    if (description.includes("feminine")) {
      features.add("feminine");
    }
    if (description.includes("masculine")) {
      features.add("masculine");
    }
    if (description.includes("plural")) {
      features.add("plural");
    }
    if (description.includes("singular")) {
      features.add("singular");
    }
    return { features };
  }

  // No specific head template: keep the entry's own tags; the caller adds them.
  return { features };
}

function mergeFormFeatures(
  base: ReadonlySet<string>,
  formTags: readonly string[],
): string[] {
  const tags = new Set(formTags.map(normalizeFeature));
  const merged = new Set(base);
  merged.delete("lemma");

  for (const group of OVERRIDE_GROUPS) {
    if ([...tags].some((tag) => group.has(tag))) {
      for (const feature of group) {
        merged.delete(feature);
      }
    }
  }

  // A finite form (person or tense) is not the infinitive/gerund/participle
  // even when the source data omitted an explicit mood tag.
  if (
    [...tags].some(
      (tag) => PERSON_FEATURES.has(tag) || TENSE_FEATURES.has(tag),
    )
  ) {
    for (const feature of VERB_FORM_FEATURES) {
      merged.delete(feature);
    }
  }

  for (const tag of tags) {
    merged.add(tag);
  }
  merged.add("inflected");
  if ([...tags].some((tag) => !CORE_FEATURES.has(tag))) {
    merged.add("derived");
  }
  return [...merged].sort();
}

function deriveBaseFeatures(
  pos: string,
  isForm: boolean,
  head: HeadInfo,
  senseTags: ReadonlySet<string>,
  forms: readonly WiktextractForm[],
): Set<string> {
  const features = new Set(head.features);
  for (const tag of senseTags) {
    features.add(tag);
  }

  if (isForm) {
    features.add("inflected");
  } else {
    features.add("lemma");
  }

  const formTags = new Set(
    forms.flatMap((form) => (form.tags ?? []).map(normalizeFeature)),
  );

  const adjectiveLike = pos === "adj" || head.declension === "it-pron-adj";

  if (pos === "noun" || pos === "name") {
    if (senseTags.has("plural-only") || senseTags.has("plural-normally")) {
      if (numberFromFeatures(features) === undefined) {
        features.add("plural");
      }
    } else if (senseTags.has("invariable")) {
      features.add("singular");
      features.add("plural");
    } else if (numberFromFeatures(features) === undefined) {
      features.add("singular");
    }
  } else if (adjectiveLike) {
    if (numberFromFeatures(features) === undefined) {
      features.add("singular");
    }
    if (genderFromFeatures(features) === undefined && formTags.has("feminine")) {
      features.add("masculine");
    }
  } else if (pos === "det") {
    if (numberFromFeatures(features) === undefined) {
      features.add("singular");
    }
    if (genderFromFeatures(features) === undefined && formTags.has("feminine")) {
      features.add("masculine");
    }
  } else if (pos === "article") {
    if (numberFromFeatures(features) === undefined) {
      features.add("singular");
    }
    if (genderFromFeatures(features) === undefined && formTags.has("feminine")) {
      features.add("masculine");
    }
  } else if (pos === "verb") {
    if (!isForm) {
      features.add("infinitive");
    } else if (
      numberFromFeatures(features) === undefined &&
      (features.has("participle") || features.has("past")) &&
      (formTags.has("feminine") || formTags.has("plural"))
    ) {
      features.add("singular");
      if (genderFromFeatures(features) === undefined) {
        features.add("masculine");
      }
    }
  }

  if (isForm && [...senseTags].some((tag) => !CORE_FEATURES.has(tag))) {
    features.add("derived");
  }

  return features;
}

function entryKey(entry: LexiconEntry): string {
  return `${normalizeWordKey(entry.word)}\u0000${entry.pos}\u0000${normalizeWordKey(entry.lemma)}\u0000${entry.features.join("\u0001")}`;
}

/**
 * Build every compact entry implied by a wiktextract entry.
 *
 * The same surface form can legitimately yield several entries (homographs,
 * multiple lemmas, different POS), so the result is a list.
 */
export function transformEntry(entry: WiktextractEntry): LexiconEntry[] {
  const word = entry.word?.trim();
  const pos = normalizePos(entry.pos ?? "");
  if (!word || !pos || /\s/.test(word) || !/\p{L}/u.test(word)) {
    return [];
  }

  const senses = entry.senses ?? [];
  const rawFormOfWords = unique(
    senses
      .flatMap((sense) => sense.form_of ?? [])
      .map((reference) => reference.word?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const formOfWords = rawFormOfWords.filter((value) => !/\s/.test(value));
  if (rawFormOfWords.length > 0 && formOfWords.length === 0) {
    return [];
  }
  const isForm = formOfWords.length > 0;
  const senseTags = new Set(
    senses.flatMap((sense) => (sense.tags ?? []).map(normalizeFeature)),
  );
  const head = headInfo(entry, pos);
  const baseFeatures = deriveBaseFeatures(
    pos,
    isForm,
    head,
    senseTags,
    entry.forms ?? [],
  );

  const lemmas = isForm ? formOfWords : [word];
  const entries = new Map<string, LexiconEntry>();

  const push = (candidate: LexiconEntry): void => {
    const key = entryKey(candidate);
    const existing = entries.get(key);
    if (existing === undefined) {
      entries.set(key, candidate);
    } else if (existing.declension === undefined && candidate.declension !== undefined) {
      existing.declension = candidate.declension;
    }
  };

  for (const lemma of lemmas) {
    push({
      word,
      lemma,
      pos,
      features: [...baseFeatures].sort(),
      declension: head.declension,
    });

    for (const form of entry.forms ?? []) {
      const formWord = form.form?.trim();
      if (!formWord || /\s/.test(formWord) || !/\p{L}/u.test(formWord)) {
        continue;
      }
      if (normalizeWordKey(formWord) === normalizeWordKey(word)) {
        continue;
      }
      const formTags = (form.tags ?? []).map(normalizeFeature);
      if (
        formTags.includes("table-tags") ||
        formTags.includes("inflection-template") ||
        formTags.includes("auxiliary")
      ) {
        continue;
      }
      const merged = new Set(mergeFormFeatures(baseFeatures, formTags));
      if (pos === "noun" || pos === "name") {
        const baseGender = genderFromFeatures(baseFeatures);
        const formGender = genderFromFeatures(new Set(formTags));
        if (
          baseGender !== undefined &&
          formGender !== undefined &&
          baseGender !== "mf" &&
          formGender !== "mf" &&
          baseGender !== formGender
        ) {
          merged.add("derived");
        }
      }
      push({
        word: formWord,
        lemma,
        pos,
        features: [...merged].sort(),
        declension: head.declension,
      });
    }
  }

  return [...entries.values()];
}
