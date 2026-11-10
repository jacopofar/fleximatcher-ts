# Annotation use cases

These recipes show what annotations are useful for beyond "does this pattern
match?".  They assume a `FlexiMatcher` and, where relevant, a Wiktionary
lexicon:

```ts
import { FlexiMatcher, AnnotationStore } from "fleximatcher";
import {
  loadWiktionaryLexicon,
  registerWiktionaryRules,
} from "fleximatcher/wiktionary";

const lexicon = await loadWiktionaryLexicon("data/wiktionary-it.jsonl.gz");
const matcher = new FlexiMatcher();
registerWiktionaryRules(matcher, lexicon, { prefix: "it" });
```

For a self-contained demo, use the browser lexicon JSON instead:

```ts
const lexicon = await loadWiktionaryLexicon(
  "web/frontend/src/demo-lexicon.json",
);
```

## 1. POS highlighting and concordance

Annotate a text once, then read the store as a table of words, lemmas and
features.

```ts
const text = "Le case sono belle, ma l'uomo dell'acqua non lo sa.";
const result = matcher.annotate(text, {
  rules: [
    "[it-article]",
    "[it-contraction]",
    "[it-noun]",
    "[it-adj]",
    "[it-verb]",
    "[it-pron]",
  ],
  onError: "collect",
});

const rows = result.annotations
  .filter((annotation) => annotation.type.startsWith("[it-"))
  .sort((left, right) => left.start - right.start)
  .map((annotation) => {
    const data = annotation.data as {
      word?: string;
      lemma?: string;
      pos?: string;
      features?: string[];
    };
    return {
      word: data.word,
      lemma: data.lemma,
      pos: data.pos,
      features: data.features?.join(" ") ?? "",
    };
  });

console.table(rows);
```

This is enough for a reader, a corpus explorer, a lemma index or a term
extraction pass.  The same annotations can be rendered as colored spans in the
playground; see [playground.md](./playground.md).

## 2. Morphological search

Use the Wiktionary query language to select forms without writing a tagger:

```ts
const queries = [
  "[it-noun:feminine plural]",
  "[it-verb:past participle]",
  "[it-verb:third-person singular present indicative]",
  "[it-adj:superlative]",
  "[it-pron:case=accusative]",
  "[it-noun:gender=f number=p !derived]",
  "[it-adj:gender=m|f number=p]",
];

for (const query of queries) {
  const result = matcher.matches(text, query, {
    matchWhole: false,
    populateResult: true,
  });
  console.log(query, result.matchingStrings(text));
}
```

Useful when building a concordancer, a grammar checker or a language-learning
exercise generator: the same index answers "all feminine plurals", "all past
participles", "all third-person singular forms" and so on.

## 3. Lexical agreement checking

Patterns can expose the article and noun as separate annotations.  Select an
interpretation where their gender/number agree, or report a mismatch.

```ts
type Nominal = { gender?: string; number?: string };

function compatible(left: Nominal, right: Nominal): boolean {
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

function agrees(text: string): boolean {
  const result = matcher.matches(text, "[it-article] [it-noun]", {
    populateResult: true,
  });
  return (result.interpretations ?? []).some((sequence) => {
    const article = sequence.find((annotation) =>
      annotation.type.startsWith("[it-article]"),
    );
    const noun = sequence.find((annotation) =>
      annotation.type.startsWith("[it-noun]"),
    );
    return (
      article !== undefined &&
      noun !== undefined &&
      compatible(article.data as Nominal, noun.data as Nominal)
    );
  });
}

agrees("Le case"); // true
agrees("Il case"); // false
```

This is a lexical sanity check, not a full syntactic parser.  It is useful as a
first-pass grammar check or as a filter before a heavier model.  Elided pairs
such as `l'uomo` need a no-space pattern (`[it-article][it-noun]`) or the
noun-phrase grammar below.

## 4. Noun-phrase extraction with a tag grammar

Tags turn annotations into a grammar.  A noun phrase can be "determiner +
nominal" or just "nominal":

```ts
matcher.addTagRule("determiner", "[it-article]", {
  identifier: "id_det",
  template: { word: "${0}" },
});
matcher.addTagRule("nominal", "[it-noun]", {
  identifier: "id_nom",
  template: { lemma: "${0.lemma}" },
});
matcher.addTagRule("noun-phrase", "[tag:determiner] [tag:nominal]", {
  identifier: "id_np",
  template: {
    determiner: "${0.word}",
    noun: "${2.lemma}", // index 1 is the literal space
  },
});
matcher.addTagRule("noun-phrase", "[tag:determiner][tag:nominal]", {
  identifier: "id_np_elision",
  template: {
    determiner: "${0.word}",
    noun: "${1.lemma}",
  },
});

const result = matcher.matches("Le case e l'uomo", "[tag:noun-phrase]", {
  matchWhole: false,
  populateResult: true,
  explain: true,
});

for (const sequence of result.interpretations ?? []) {
  const phrase = sequence.at(-1);
  console.log(phrase?.data);
}
```

Outputs include `{ determiner: "Le", noun: "casa" }` and
`{ determiner: "l'", noun: "uomo" }`.  Because the grammar is recursive, you can
compose larger units from these tags.

## 5. Entity / domain grammar

The same mechanism works for domain entities.  Define productions over custom
rules or lexical annotations:

```ts
matcher.addTagRule("fruit", "pear", {
  identifier: "id_pear",
  template: { lemma: "pear" },
});
matcher.addTagRule("fruit", "apple", {
  identifier: "id_apple",
  template: { lemma: "apple" },
});
matcher.addTagRule("fruit", "a [tag:fruit]", {
  identifier: "id_a_fruit",
  template: { article: "${0}", fruit: "${1.lemma}" },
});

matcher.matches("I ate a pear", "ate [tag:fruit]", {
  populateResult: true,
  explain: true,
});
```

The annotation data carries the derived entity information and the
`__explain` tree records exactly which production produced it.  This is useful
for bot intents, catalog lookup, ticket routing, recipe/ingredient parsing or any
domain where a small grammar beats a large model.

## 6. Explainable parsing and debugging

With `explain: true`, every tag annotation tells you how it was derived:

```ts
const result = matcher.matches(text, "[tag:noun-phrase]", {
  populateResult: true,
  explain: true,
});

function print(node: any, depth = 0): void {
  if (!node) return;
  console.log(`${"  ".repeat(depth)}${node.id ?? "(root)"}`);
  for (const child of node.children ?? []) {
    console.log(
      `${"  ".repeat(depth + 1)}${child.type} [${child.start}:${child.end}]`,
    );
    print(child.__explain, depth + 1);
  }
}

for (const sequence of result.interpretations ?? []) {
  const tag = sequence.at(-1);
  print((tag?.data as any)?.__explain);
}
```

The playground renders this as a flame chart and a nested tree.  This is
valuable when a grammar behaves unexpectedly: instead of guessing why a tag
matched, inspect the production identifier and child spans.

## 7. Custom NLP model or gazetteer integration

The core has no NLP models by design.  Wrap your model in a rule factory:

```ts
import type { Annotator, Rule, RuleFactory } from "fleximatcher";

class GazetteerFactory implements RuleFactory {
  constructor(private readonly entries: Map<string, string>) {}

  getRule(parameter: string): Rule {
    const accepted = parameter || null;
    return {
      annotate: (text: string, annotator: Annotator) => {
        for (const [surface, kind] of this.entries) {
          if (accepted !== null && kind !== accepted) continue;
          let start = 0;
          while (true) {
            const index = text.indexOf(surface, start);
            if (index === -1) break;
            annotator.add(index, index + surface.length, {
              kind,
              source: "gazetteer",
            });
            start = index + 1;
          }
        }
        return false;
      },
    };
  }

  generateSample(parameter: string): string | null {
    for (const [surface, kind] of this.entries) {
      if (!parameter || kind === parameter) return surface;
    }
    return null;
  }
}

matcher.bind(
  "place",
  new GazetteerFactory(
    new Map([
      ["Milano", "city"],
      ["Lombardia", "region"],
    ]),
  ),
);

matcher.matches("Vivo a Milano", "Vivo a [place:city]").matching; // true
```

The same shape adapts a POS tagger, a dependency parser, a database lookup or an
embedding nearest-neighbor service.  Keep the outer API synchronous; prefetch
remote data or wrap the matcher in an application-level async layer if needed
(see [annotations.md](./annotations.md)).

## 8. Multi-pass corpus analysis

A single store can accumulate annotations from several passes and several
patterns:

```ts
const text = "Ha dato una mela a Maria.";
const store = new AnnotationStore({ text });

// Pass 1: lexical annotations.
for (const chunk of ["[it-verb]", "[it-noun]", "[it-name]"]) {
  matcher.matches(text, chunk, { store, matchWhole: false });
}

// Pass 2: a pattern over those annotations.
matcher.matches(text, "[it-verb] [it-noun]", {
  store,
  matchWhole: false,
  populateResult: true,
});

// Pass 3: a tag grammar over the same store.
matcher.matches(text, "[tag:noun-phrase]", {
  store,
  matchWhole: false,
  populateResult: true,
});

const byPos = new Map<string, number>();
for (const annotation of store.annotations) {
  const data = annotation.data as { pos?: string };
  if (data.pos) {
    byPos.set(data.pos, (byPos.get(data.pos) ?? 0) + 1);
  }
}
```

This is how an NLP pipeline can build lexical, syntactic and domain layers on
top of the same spans.  Reuse the store to avoid recomputing the same rule
annotations.

## 9. Language-learning and declension drills

The feature fields are enough to generate exercises:

```ts
function formsOf(lemma: string, pos: string): string[] {
  return [...lexicon.entries()]
    .filter((entry) => entry.pos === pos && entry.lemma === lemma)
    .map((entry) => entry.word);
}

formsOf("casa", "noun");   // forms sharing the lemma
formsOf("libero", "adj");
formsOf("dare", "verb");
```

Queries can ask for a specific cell in a paradigm:

```ts
matcher.matches("case", "[it-noun:feminine plural]").matching; // true
matcher.matches("dà", "[it-verb:third-person singular present indicative]").matching;
matcher.matches("liberissima", "[it-adj:superlative]").matching;
```

The `declension` field groups words into classes such as `it-noun:f`,
`it-verb:a/@` and `it-adj`, which is useful for pattern drills, "find another
word in this class" exercises or generating fill-in-the-blank prompts.

## 10. Serving annotations to another application

The playground server exposes the same model over HTTP:

```bash
curl -s http://localhost:8787/api/annotate \
  -H 'content-type: application/json' \
  -d '{
    "text": "Le case sono belle",
    "annotators": ["[it-noun]", "[it-adj]"],
    "pattern": "Le [it-noun:feminine plural] sono [it-adj:feminine plural]",
    "options": { "matchWhole": false }
  }'
```

A frontend, a notebook or another service can consume `annotations` and
`interpretations` without embedding the lexicon.  See
[playground.md](./playground.md) for the full API contract.

## 11. Guarding ambiguity with budgets and ranking

When a grammar is ambiguous, collect interpretations under a budget and rank
them:

```ts
const result = matcher.matches(text, "[tag:noun-phrase]", {
  populateResult: true,
  maxInterpretations: 200,
  maxAnnotations: 20_000,
  timeoutMs: 1_000,
  rankInterpretation: (sequence) =>
    sequence.reduce((score, annotation) => score + annotation.end - annotation.start, 0),
  strategy: "best",
});

if (result.truncated) {
  // the result was capped; log or adjust the grammar
}
```

`maxInterpretations` caps collection, not whether the match is found.
`timeoutMs` and `signal` throw `BudgetExceededError` cooperatively.

## 12. Typed annotation schemas

Use a schema to validate or coerce data before it reaches the store:

```ts
matcher.addTagRule<{ value: number }>("quantity", "[r:\\d+]", {
  identifier: "id_quantity",
  template: ({ covered }) => ({ value: Number(covered(0)) }),
  schema: (raw) => {
    const value = (raw as { value?: unknown }).value;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("quantity must be numeric");
    }
    return { value };
  },
});

const quantity = matcher.matches("42", "[tag:quantity]", {
  populateResult: true,
}).store.ofType<{ value: number }>("[tag:quantity]")[0];
quantity?.data.value; // number
```

## 13. Asking why an annotation exists

Build a provenance graph from the explained annotations and ask for all
root-to-node paths:

```ts
import { ProvenanceGraph } from "fleximatcher";

const graph = ProvenanceGraph.fromAnnotations(
  result.store.annotations,
  text,
);
const tag = result.store.ofType("[tag:noun-phrase]")[0];
const paths = tag === undefined ? [] : graph.why(tag);

for (const path of paths) {
  console.log(path.map((node) => node.type).join(" › "));
}
```

A shared child yields one path per parent chain.  `graph.toJSON()` and
`graph.toSVG()` export the DAG; the playground also offers PNG export.

## Choosing an approach

| need | approach |
| --- | --- |
| highlight words by POS/lemma | annotate with `[it-*]` rules and read store data |
| search morphology | query parameters such as `[it-noun:feminine plural]` |
| check agreement / local syntax | patterns plus interpretation data |
| domain entities / multiword units | tag grammar with templates |
| explain why a tag matched | `explain: true` + `__explain` tree |
| integrate a model or database | custom `RuleFactory` |
| multiple analysis layers | one `AnnotationStore`, several passes |
| use from another process | playground server or your own API around the library |
