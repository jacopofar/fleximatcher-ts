#!/usr/bin/env node
/**
 * Print the annotations produced for a text.
 *
 * Usage:
 *   npm run build
 *   node examples/annotate.mjs [lexicon] [text]
 *
 * The default lexicon is the committed browser demo lexicon.  Pass
 * data/wiktionary-it.jsonl.gz for the full Italian lexicon.
 */

import { fileURLToPath } from "node:url";

import { AnnotationStore, FlexiMatcher } from "../dist/browser.js";
import {
  loadWiktionaryLexicon,
  registerWiktionaryRules,
} from "../dist/wiktionary/index.js";

const defaultLexicon = fileURLToPath(
  new URL("../web/frontend/src/demo-lexicon.json", import.meta.url),
);
const lexiconPath = process.argv[2] ?? defaultLexicon;
const text =
  process.argv[3] ?? "Le case sono belle, ma l'uomo dell'acqua non lo sa.";

const lexicon = await loadWiktionaryLexicon(lexiconPath);
const matcher = new FlexiMatcher();
registerWiktionaryRules(matcher, lexicon, { prefix: lexicon.language });

const store = new AnnotationStore({ text });
const annotators = [
  "[it-article]",
  "[it-contraction]",
  "[it-noun]",
  "[it-adj]",
  "[it-verb]",
  "[it-pron]",
];

const annotationRun = matcher.annotate(text, {
  rules: annotators,
  store,
  fullyAnnotate: true,
  onError: "collect",
});

const rows = annotationRun.annotations
  .filter((annotation) => annotation.type.startsWith("[it-"))
  .sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.type.localeCompare(right.type),
  )
  .map((annotation) => {
    const data = annotation.data ?? {};
    return {
      span: `${annotation.start}:${annotation.end}`,
      word: data.word ?? text.slice(annotation.start, annotation.end),
      type: annotation.type,
      lemma: data.lemma ?? "",
      pos: data.pos ?? "",
      gender: data.gender ?? "",
      number: data.number ?? "",
      case: data.case ?? "",
      mood: data.mood ?? "",
      tense: data.tense ?? "",
      declension: data.declension ?? "",
    };
  });

console.log(`lexicon: ${lexicon}`);
console.log(`text:    ${JSON.stringify(text)}`);
console.log(`matches: ${rows.length}`);
if (annotationRun.errors.length > 0) {
  console.error(annotationRun.errors);
}
console.table(rows);
