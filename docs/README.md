# Fleximatcher documentation

This folder is the deep reference for the library and the playground.  The
project README is the quick overview; these documents explain the model,
the Wiktionary annotators, the web UI and concrete annotation use cases.

| document | what it covers |
| --- | --- |
| [annotations.md](./annotations.md) | annotation model, stores, matching, interpretations, diagnostics, budgets, ranking, macros, async rules, typed schemas, templates and provenance graphs |
| [wiktionary.md](./wiktionary.md) | building and loading the Italian lexicon, POS rules, query language, feature semantics, tokenization, annotation data and limitations |
| [playground.md](./playground.md) | the Vite/Node playground, client and server modes, controls, flame hierarchy, API and development workflow |
| [use-cases.md](./use-cases.md) | practical annotation recipes: POS highlighting, concordances, morphological search, agreement checks, noun-phrase grammars, explainable parsing and custom rule integration |

Runnable examples live in [`../examples`](../examples/README.md).

## The mental model in one page

1. A **rule** annotates spans of a text.  A span has a `start`, an `end`, a
   `type` (the rule chunk that produced it, such as `[it-noun]`) and optional
   JSON-like `data`.
2. A **pattern** is a sequence of literal text and rule chunks, such as
   `Le [it-noun] sono [it-adj]`.
3. Matching is a search for consecutive annotations that cover the pattern
   chunks in order.
4. An `AnnotationStore` collects annotations for one text and deduplicates
   identical spans/types/data.
5. Tags are grammar productions that annotate a span based on *other*
   annotations.  With explanations enabled, a tag annotation records its
   children in `data.__explain`; that is the hierarchy the playground renders as
   a flame/icicle chart.

## Quick code example

```ts
import { FlexiMatcher, AnnotationStore } from "fleximatcher";

const matcher = new FlexiMatcher();
const text = "the dog eats a pear";
const store = new AnnotationStore({ text });

matcher.matches(text, "[i:DOG]", {
  store,
  matchWhole: false,
  fullyAnnotate: true,
});

for (const annotation of store.annotations) {
  console.log(annotation.start, annotation.end, annotation.type);
}
```
