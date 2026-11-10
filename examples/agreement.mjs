#!/usr/bin/env node
/**
 * A small lexical agreement check: does any reading of
 * "[it-article] [it-noun]" have compatible gender/number?
 *
 * Usage:
 *   npm run build
 *   node examples/agreement.mjs [lexicon]
 */

import { fileURLToPath } from "node:url";

import { FlexiMatcher } from "../dist/browser.js";
import {
  loadWiktionaryLexicon,
  registerWiktionaryRules,
} from "../dist/wiktionary/index.js";

const defaultLexicon = fileURLToPath(
  new URL("../web/frontend/src/demo-lexicon.json", import.meta.url),
);
const lexiconPath = process.argv[2] ?? defaultLexicon;
const lexicon = await loadWiktionaryLexicon(lexiconPath);
const matcher = new FlexiMatcher();
registerWiktionaryRules(matcher, lexicon, { prefix: lexicon.language });

function compatible(left, right) {
  const genderOk =
    left.gender === undefined ||
    right.gender === undefined ||
    left.gender === right.gender ||
    left.gender === "mf" ||
    right.gender === "mf";
  const numberOk =
    left.number === undefined ||
    right.number === undefined ||
    left.number === right.number;
  return genderOk && numberOk;
}

function agrees(text) {
  const result = matcher.matches(text, "[it-article] [it-noun]", {
    populateResult: true,
  });
  const readings = result.interpretations ?? [];
  const accepted = readings.some((sequence) => {
    const article = sequence.find((annotation) =>
      annotation.type.startsWith("[it-article]"),
    );
    const noun = sequence.find((annotation) =>
      annotation.type.startsWith("[it-noun]"),
    );
    return (
      article !== undefined &&
      noun !== undefined &&
      compatible(article.data ?? {}, noun.data ?? {})
    );
  });
  return { text, matches: result.matching, readings: readings.length, agrees: accepted };
}

const sentences = [
  "La casa",
  "Le case",
  "Il case",
  "La case",
  "Una mela",
];

console.log(`lexicon: ${lexicon}`);
console.table(sentences.map(agrees));
