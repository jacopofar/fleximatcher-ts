#!/usr/bin/env node
/**
 * Show a tag grammar and print its derivation hierarchy.
 *
 * Usage:
 *   npm run build
 *   node examples/tag-hierarchy.mjs [lexicon] [text]
 */

import { fileURLToPath } from "node:url";

import { FlexiMatcher, ProvenanceGraph } from "../dist/browser.js";
import {
  loadWiktionaryLexicon,
  registerWiktionaryRules,
} from "../dist/wiktionary/index.js";

const defaultLexicon = fileURLToPath(
  new URL("../web/frontend/src/demo-lexicon.json", import.meta.url),
);
const lexiconPath = process.argv[2] ?? defaultLexicon;
const text =
  process.argv[3] ??
  "Le case sono belle, ma l'uomo dell'acqua non lo sa.";

const lexicon = await loadWiktionaryLexicon(lexiconPath);
const matcher = new FlexiMatcher({ explain: true });
registerWiktionaryRules(matcher, lexicon, { prefix: lexicon.language });

matcher.addTagRule("determiner", "[it-article]", {
  identifier: "id_det",
  template: { word: "${0}" },
});
matcher.addTagRule("determiner", "[it-contraction]", {
  identifier: "id_det_contr",
  template: { word: "${0}" },
});
matcher.addTagRule("nominal", "[it-noun]", {
  identifier: "id_nom",
  template: { lemma: "${0.lemma}" },
});
matcher.addTagRule("noun-phrase", "[tag:determiner] [tag:nominal]", {
  identifier: "id_np",
  template: { determiner: "${0.word}", noun: "${2.lemma}" },
});
matcher.addTagRule("noun-phrase", "[tag:determiner][tag:nominal]", {
  identifier: "id_np_elision",
  template: { determiner: "${0.word}", noun: "${1.lemma}" },
});
matcher.addTagRule("noun-phrase", "[tag:nominal]", {
  identifier: "id_np_nom",
  template: { noun: "${0.lemma}" },
});

const result = matcher.matches(text, "[tag:noun-phrase]", {
  matchWhole: false,
  populateResult: true,
  explain: true,
});

console.log(`text: ${JSON.stringify(text)}`);
console.log(`interpretations: ${result.interpretations?.length ?? 0}`);
console.log();

const graph = ProvenanceGraph.fromAnnotations(result.store.annotations, text);

function printExplain(explain, depth = 0) {
  if (!explain) return;
  console.log(`${"  ".repeat(depth)}via ${explain.id ?? "(unknown)"}`);
  for (const child of explain.children ?? []) {
    if (!child.type.startsWith("[") && child.__explain === undefined) {
      continue;
    }
    console.log(
      `${"  ".repeat(depth + 1)}${child.type} [${child.start}:${child.end}]`,
    );
    printExplain(child.__explain, depth + 1);
  }
}

for (const [index, sequence] of (result.interpretations ?? []).entries()) {
  const phrase = sequence.at(-1);
  console.log(`Interpretation ${index + 1}: ${phrase?.coveredText(text)}`);
  console.log(`  data: ${JSON.stringify(phrase?.data)}`);
  printExplain(phrase?.data?.__explain, 1);
  const paths = phrase === undefined ? [] : graph.why(phrase);
  console.log(`  provenance paths: ${paths.length}`);
  for (const path of paths) {
    console.log(`    ${path.map((node) => node.type).join(" › ")}`);
  }
  console.log();
}
