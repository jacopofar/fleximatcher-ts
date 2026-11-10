# Runnable examples

Build the library first:

```sh
npm run build
```

The examples use the committed browser demo lexicon by default.  Pass
`data/wiktionary-it.jsonl.gz` as the first argument to use the full lexicon.

## Annotate a text

```sh
npm run examples:annotate
node examples/annotate.mjs web/frontend/src/demo-lexicon.json "Le case sono belle"
node examples/annotate.mjs data/wiktionary-it.jsonl.gz "Le case sono belle"
```

Prints a table of spans, types, lemmas, POS, gender, number, case, mood, tense
and declension.

This is the basic use case: turn text into inspectable lexical annotations.

## Tag grammar and derivation hierarchy

```sh
npm run examples:hierarchy
node examples/tag-hierarchy.mjs
```

Builds a `determiner` / `nominal` / `noun-phrase` grammar, matches
`[tag:noun-phrase]` with explanations and prints the `__explain` tree.

This is the use case behind the playground's flame diagram: showing which
annotations were used to derive which other annotations.

## Agreement check

```sh
npm run examples:agreement
node examples/agreement.mjs
```

Uses the pattern `[it-article] [it-noun]` and checks whether any reading has
compatible gender/number.  It is a lexical first-pass check, not a full parser.

## Documentation

- [Annotation model](../docs/annotations.md)
- [Wiktionary annotators](../docs/wiktionary.md)
- [Use cases](../docs/use-cases.md)
- [Web playground](../docs/playground.md)
