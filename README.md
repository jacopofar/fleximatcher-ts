# fleximatcher

Annotate and bottom-up parse natural language text with composable rules and
tags.  This is a TypeScript reimplementation of the archived
[Java library of the same name](https://github.com/jacopofar/fleximatcher),
influenced by the Python port that lived alongside it.

The library is deliberately small: no runtime dependencies, no NLP models, no
tokenizer.  You bring the language-specific pieces (POS taggers, gazetteers,
tokenizers, embeddings, …) as *rules*, and fleximatcher combines them into
patterns and recursive grammars.

```ts
import { FlexiMatcher } from "fleximatcher";

const matcher = new FlexiMatcher();
matcher.addTagRule("fruit", "pear", {
  identifier: "id_pear",
  template: { fruitName: "pear" },
});
matcher.addTagRule("fruit", "a [tag:fruit]", {
  identifier: "id_a_fruit",
  template: {
    fruitName: "${1.fruitName}",
    article: "${0}",
  },
});

const result = matcher.matches(
  "the dog eats a pear",
  "the dog eats [tag:fruit]",
  { populateResult: true },
);

console.log(result.matching); // true
console.log(result.interpretations?.[0]?.at(-1)?.data);
// { fruitName: "pear", article: "a " }
```

## Install

```sh
npm install fleximatcher
```

Requires Node.js 25 or newer.  The package is ESM-only and ships TypeScript
declarations.

## Documentation

The deep documentation lives in [`docs/`](./docs/README.md):

- [`docs/annotations.md`](./docs/annotations.md) — annotation model, stores,
  matching, interpretations, budgets, ranking, custom rules, typed schemas,
  templates and provenance graphs.
- [`docs/wiktionary.md`](./docs/wiktionary.md) — building/loading the Italian
  lexicon, POS rules, query language, feature semantics, annotation data and
  limitations.
- [`docs/playground.md`](./docs/playground.md) — client/server modes, UI
  controls, flame hierarchy, API and development workflow.
- [`docs/use-cases.md`](./docs/use-cases.md) — POS highlighting, concordances,
  morphological search, agreement checks, noun-phrase grammars, explainable
  parsing and custom rule integration.

Runnable examples are in [`examples/`](./examples/README.md):

```sh
npm run build
node examples/annotate.mjs
node examples/tag-hierarchy.mjs
node examples/agreement.mjs
```

## How it works

A pattern mixes literal text with rule invocations in square brackets:

```text
the [i:dog] eats [tag:fruit]
```

Every chunk annotates the input text with spans:

- literal text is matched exactly and annotated with the text itself;
- `[rule:parameter]` delegates to a rule, which adds spans of its own;
- matching then becomes a search for consecutive annotations that cover the
  pattern chunks in order.

Because every rule can produce many spans, a pattern can have many
interpretations.  Ask for all of them with `populateResult: true`.

```ts
const matcher = new FlexiMatcher();
const result = matcher.matches("an apple and a pear", "[r:[a-z]+]", {
  matchWhole: false,
  populateResult: true,
});

result.interpretations; // one annotation sequence per word
```

## Compiled patterns

When the same pattern is matched against many texts, or when the grammar is
large, compile it once:

```ts
const compiled = matcher.compile("the [i:dog] eats [tag:fruit]");

for (const line of lines) {
  const result = compiled.matches(line, { populateResult: true });
}
```

Compilation splits the pattern and resolves every rule chunk to a rule
instance.  Tag productions and `multi` sub-patterns are compiled lazily and
cached too, so recursive grammars do not re-parse their patterns on every
closure iteration.

Compiled patterns are not frozen: if you rebind a rule, the next match notices
the new factory and recreates only the affected rule instance.  Tag grammar
changes are always picked up because `[tag:...]` reads the current productions
at match time.

Compiled patterns reuse rule instances across matches, so rules should be
stateless/pure — the same assumption the original library made.

## Pattern chunks

A chunk has the form `[name]` or `[name:parameter]`.  The parameter is
everything after the first colon, including whitespace:

```text
[token]             rule "token", empty parameter
[it-pos: Ss]        rule "it-pos", parameter " Ss"
[r:[a-z]+]          rule "r", parameter "[a-z]+"
[multi:[i:a][i:b]]  rule "multi", nested chunks
```

Square brackets may nest; `splitPattern` keeps nested chunks together.

## Built-in rules

| rule | meaning |
| --- | --- |
| `[i:text]` | case-insensitive literal text |
| `[r:regexp]` | JavaScript regular expression |
| `[multi:...]` | intersection of several sub-patterns |
| `[or:a|b]` | union of several alternatives |
| `[repeat:pattern]` | one or more contiguous repetitions |
| `[optional:pattern]` | zero or one occurrence of a pattern |
| `[ws]` | one or more whitespace characters |
| `[word:text]` | a whole word, case-insensitive |
| `[char:code]` | one Unicode code point, decimal or `0x` hex |
| `[tag:name]` | a previously defined tag (a grammar production) |

### `i`

```ts
matcher.matches("Hello world", "Hello [i:WORLD]").matching; // true
```

### `r`

Regex spans are found exhaustively: overlapping matches and alternative
lengths are all annotated, so `a|ab` knows about both `"a"` and `"ab"`.

```ts
matcher.matches("A12", "[r:[AX][1-9][0-9]*]").matching; // true
matcher.matches("A01", "[r:[AX][1-9][0-9]*]").matching; // false
```

Regexes are evaluated against suffixes of the text, as in the original
implementation.  Exhaustive matching is O(n²) in the worst case; set
`regexMaxSpan` when a pattern can match long stretches:

```ts
const matcher = new FlexiMatcher({ regexMaxSpan: 200 });
```

Flags default to `"u"` and can be changed globally:

```ts
const matcher = new FlexiMatcher({ regexFlags: "iu" });
```

The stateful `g` and `y` flags are ignored.

### `multi`

`multi` annotates a span only when every condition annotates exactly that span.

```ts
matcher.matches("AbC", "A[multi:[r:[bD]+][i:B]]C").matching; // true
```

The extra brackets used by the original README are accepted:
`[multi:[[r:[bD]+][i:B]]]`.

### `or`

`or` annotates the span covered by any successful alternative:

```ts
matcher.matches("cat", "[or:[i:cat]|[i:dog]]").matching; // true
matcher.matches("the dog", "[or:[i:the] [i:dog]|[i:cat]]").matching; // true
```

`|` separates alternatives only at bracket depth zero, so
`[or:[r:a|b]|[i:c]]` works as expected.  The annotation data records which
alternatives matched:

```json
{ "alternatives": ["[i:cat]", "[i:CAT]"] }
```

### `repeat`

`repeat` annotates spans made of one or more contiguous repetitions of a
pattern:

```ts
matcher.matches("hahaha", "[repeat:[i:ha]]").matching;               // true
matcher.matches("ha!ha!", "[repeat:[i:ha][i:!]]").matching;          // true
```

Annotation data lists the repetition counts that produced each span:

```json
{ "repetitions": [1, 2, 3] }
```

The default enumeration cap is 16 repetitions; rebind `repeat` with
`RepeatRuleFactory({ maxRepetitions })` to change it.

### `optional`

`optional` wraps a sub-pattern that may occur zero or one time:

```ts
matcher.matches("a c", "[i:a][ws][optional:[i:b][ws]][i:c]").matching; // true
matcher.matches("a b c", "[i:a][ws][optional:[i:b][ws]][i:c]").matching; // true
```

The sequence matcher keeps both paths: skip the chunk, or consume a span it
annotated.  No zero-length annotations are created.  The zero path is simply
absent from the interpretation, so a tag production that uses `optional`
cannot use positional `${N}` templates — use a function template instead:

```ts
matcher.addTagRule("kind", "[i:a][ws][optional:[i:b]]", {
  identifier: "id_kind",
  template: ({ sequence }) => ({ parts: sequence.length }),
});
```

Rebind `optional` with `OptionalRuleFactory(matcher)` if you need a different
sub-pattern engine, but keep `optional: true` on the factory so the sequence
matcher knows it may skip the chunk.

### `ws`

`ws` annotates runs of one or more whitespace characters, including newlines:

```ts
matcher.matches("a   b", "[i:a][ws][i:b]").matching; // true
matcher.matches("a\n\tb", "[i:a][ws][i:b]").matching; // true
```

### `word`

`word` is a case-insensitive whole-word literal.  Unlike `[i:text]` it does not
match substrings, so `[word:non]` does not match inside *nonostante*:

```ts
matcher.contains("non sono", "[word:non]"); // true
matcher.contains("nonostante", "[word:non]"); // false
```

Italian elisions are exposed both as the whole run and as their
apostrophe-separated pieces: `l'uomo` is `l'uomo`, `l'` and `uomo`.

### Pattern macros

Macros are named fragments expanded at compile time:

```ts
matcher.defineMacro("article", "[or:[i:il]|[i:lo]|[i:la]|[i:i]]");
matcher.defineMacro("noun", "[it-noun]");
matcher.defineMacro("np", "{{article}} {{noun}}");

matcher.matches("la casa", "{{np}}").matching; // true
matcher.compile("{{np}}").expandedPattern;     // "[or:...] [it-noun]"

matcher.macroNames;
matcher.getMacro("article");
matcher.removeMacro("article");
matcher.clearMacros();
```

Macros work in `matches`, `compile`, `generateSample` and tag productions.
Expansion is recursive, cycle-checked and depth-limited (`UnknownMacroError`
for undefined names, `PatternError` for cycles).  They stay declarative and
are safe for TSV/server rules.

```ts
const configured = new FlexiMatcher({ macros: { greeting: "[i:hello]" } });
```

### `char`

```ts
matcher.matches("AbC", "A[char:98]C").matching;       // true
matcher.matches("AbC", "A[char:0x62]C").matching;     // true
matcher.matches("😗", "[char:0x1F617]").matching;      // true
```

Offsets are UTF-16 code units, the same units as `String.prototype.slice`.
An astral character such as an emoji therefore spans two units.

### `tag`

Tags are grammar productions.  They may be recursive or mutually recursive.

```ts
matcher.addTagRule("fruit", "pear", {
  identifier: "id_pear",
  template: { name: "pear" },
});
matcher.addTagRule("fruit", "a [tag:fruit]", {
  identifier: "id_a_fruit",
  template: {
    article: "${0}",
    inner: "${1.name}",
  },
});

matcher.matches("a pear", "[tag:fruit]").matching; // true
```

Productions are re-evaluated until no new annotation appears.  The maximum
nesting depth defaults to `15`:

```ts
matcher.maximumTagNesting = 30;              // property
matcher.setMaximumTagNesting(30);            // method
matcher.throwExceptionWhenReachingMaximumDepth(true); // throw instead of stopping
```

An identifier lets you replace or remove a production later:

```ts
matcher.addTagRule("fruit", "apple", { identifier: "id_pear" }); // replaces the pear production
matcher.removeTagRule("fruit", "id_pear");
```

## Annotation templates

A tag production can attach JSON-like data to the span it matches.  There are
three forms.

### 1. Lenient JSON string with `${...}` placeholders

```ts
matcher.addTagRule("fruit", "a [tag:fruit]", {
  identifier: "id_a_fruit",
  template: "{'article':'${0}','inner':${1.name}}",
});
```

- `${N}` inserts the text covered by the N-th chunk.
- `${N.path}` reads a property from the N-th chunk's annotation.
- `${N.items[0]}` indexes arrays.
- In value position (`{'inner':${1.name}}`) the value is inserted as a JSON
  literal, so strings stay quoted and numbers stay numbers.
- Inside a quoted string (`{'article':'${0}'}`) the value is inserted as
  escaped string content.

The parser is deliberately lenient: single quotes, unquoted keys and bare
values are accepted, matching the behavior of the original `org.json`-based
implementation.

### 2. Native object or array

String leaves are expanded recursively.  An exact placeholder preserves the
original type:

```ts
matcher.addTagRule("fruit", "pear", {
  identifier: "id_pear",
  template: {
    name: "pear",
    count: 3,
    labels: ["fresh", "edible"],
  },
});
matcher.addTagRule("fruit", "a [tag:fruit]", {
  identifier: "id_a_fruit",
  template: {
    name: "${1.name}",        // string
    count: "${1.count}",      // still a number
    labels: "${1.labels}",    // still an array
    article: "prefix-${0}",   // embedded substitution
  },
});
```

### 3. Function

A function template receives the matched sequence and returns arbitrary data.
It must be synchronous.

```ts
matcher.addTagRule("word", "[r:[a-z]+]", {
  identifier: "id_word",
  template: ({ sequence, text, covered }) => ({
    text: covered(0),
    upper: text.slice(sequence[0].start, sequence[0].end).toUpperCase(),
  }),
});
```

## Explain mode

When explanations are enabled, tag annotations get an `__explain` field that
records the production identifier and the child annotations:

```ts
const result = matcher.matches("a pear", "[tag:fruit]", {
  populateResult: true,
  explain: true,
});
console.log(result.interpretations?.[0]?.[0]?.data);
// { article: "a ", __explain: { id: "id_a_fruit", children: [...] } }
```

## Wiktionary annotators

The optional `fleximatcher/wiktionary` module turns a
[wiktextract](https://github.com/tatuylonen/wiktextract) dump into a compact
lexicon and exposes word-class and inflection annotators.  The dump itself is
an input you download, not part of the package; see
[`tools/wiktextract/README.md`](./tools/wiktextract/README.md) for what it is,
where to get it, and the credits and data license attached to it.

```ts
import { FlexiMatcher } from "fleximatcher";
import {
  loadWiktionaryLexicon,
  registerWiktionaryRules,
} from "fleximatcher/wiktionary";

const lexicon = await loadWiktionaryLexicon("data/wiktionary-it.jsonl.gz");
const matcher = new FlexiMatcher();
registerWiktionaryRules(matcher, lexicon, { prefix: "it" });

matcher.matches("Le case sono belle", "Le [it-noun:feminine plural] sono [it-adj:feminine plural]").matching;
// true
```

The default registration binds these rules:

`it-noun`, `it-name`, `it-adj`, `it-verb`, `it-adv`, `it-pron`, `it-det`,
`it-article`, `it-prep`, `it-conj`, `it-intj`, `it-num`, `it-particle`,
`it-contraction`.

A rule parameter is a whitespace- or comma-separated query:

```text
[it-noun]                                  any noun
[it-noun:feminine singular]                a feminine singular noun
[it-noun:gender=f number=p !derived]       feminine plural, no derivational form
[it-noun:declension=it-noun:f]             nouns in the -a/-e class
[it-verb:third-person singular present]    finite verb form
[it-verb:past participle]                  past participle
[it-adj:superlative]                       superlative adjective
```

Supported query fields are `gender` (`m`, `f`, `mf`), `number` (`s`, `p`),
`case`, `person` (`1`, `2`, `3`), `mood`, `tense`, `verbForm`, `declension`,
`pos`, `lemma`, and `feature`.  A bare token is a feature tag; prefix it with
`!` to exclude it.  Alternatives inside a field use `|`:

```text
[it-adj:gender=m|f number=p]
```

Annotations contain the matched surface word, lemma, POS, feature tags and the
structured fields:

```json
{
  "source": "wiktionary",
  "language": "it",
  "word": "case",
  "canonical": "case",
  "lemma": "casa",
  "pos": "noun",
  "features": ["inflected", "feminine", "plural"],
  "gender": "f",
  "number": "p",
  "declension": "it-noun:f"
}
```

The tokenizer keeps Italian elisions as separate pieces: `dell'acqua` is looked
up as `dell'` and `acqua`, and `L'uomo` as `L'` and `uomo`.

### Building the lexicon

The builder streams the raw dump and writes gzipped NDJSON:

```sh
npm run build
node dist/wiktionary/build.js \
  --input data/raw-wiktextract-data.jsonl.gz \
  --output data/wiktionary-it.jsonl.gz \
  --language it --language-name Italian
```

The raw dump (~2.9 GB gzipped) is not committed.  Download it from kaikki.org
as described in [`tools/wiktextract/README.md`](./tools/wiktextract/README.md),
which also carries the wiktextract credits and the Wiktionary data license.

Or, after installing the package:

```sh
npx fleximatcher-wiktionary \
  --input raw-wiktextract-data.jsonl.gz \
  --output wiktionary-it.jsonl.gz \
  --language it
```

The full Italian artifact has about 1.5M entries and is roughly 12 MB gzipped.
Loading it takes a few seconds and a significant amount of memory; if you only
need some word classes, filter at load time:

```ts
const lexicon = await loadWiktionaryLexicon("data/wiktionary-it.jsonl.gz", {
  pos: ["noun", "adj", "verb"],
});
```

The builder keeps lemmas and inflected forms, including derivational and
alternative forms.  Derived forms carry the `derived` feature; use `!derived`
to exclude them.

## Custom rules

Rules are synchronous annotators.  A rule receives the text and an
`Annotator`; it adds spans and returns whether its own pattern covered the
whole text.  The return value is advisory: matching is decided by the
annotations.

```ts
import { FlexiMatcher, type Rule, type RuleFactory } from "fleximatcher";

class EmojiFactory implements RuleFactory {
  getRule(parameter: string): Rule {
    return {
      annotate(text, annotator) {
        for (let index = 0; index < text.length; index += 1) {
          const codePoint = text.codePointAt(index)!;
          if (codePoint > 0x1f000) {
            const width = codePoint > 0xffff ? 2 : 1;
            annotator.add(index, index + width, { codePoint });
            index += width - 1;
          }
        }
        return false;
      },
    };
  }

  generateSample() {
    return "😗";
  }
}

const matcher = new FlexiMatcher();
matcher.bind("emoji", new EmojiFactory());
matcher.matches("a 😗 b", "a [emoji] b").matching; // true
```

Rules can recurse into the matcher through `annotator.match(text, pattern)`,
which shares the annotation store and therefore avoids recomputing the same
annotations.  The text must be the one being annotated; mixing texts in one
store would corrupt every offset.

## Async rules

The core stays synchronous, but remote models can be prefetched and bound as
cached synchronous rules:

```ts
import { FlexiMatcher, matchesAsync, type AsyncRuleFactory } from "fleximatcher";

const remotePos: AsyncRuleFactory = {
  async analyze(text, parameter) {
    const spans = await callRemoteModel(text, parameter);
    return spans; // [{ start, end, data }]
  },
  generateSample: () => "casa",
};

const matcher = new FlexiMatcher();
matcher.addTagRule("noun-phrase", "[remote-pos:NOUN]", {
  identifier: "id_np",
});

const result = await matchesAsync(matcher, "la casa", "[tag:noun-phrase]", {
  matchWhole: false,
  asyncRules: [
    { name: "remote-pos", factory: remotePos, parameters: ["NOUN"] },
  ],
});

result.release();
```

`prefetchAsyncRules` awaits the analysis, binds cached synchronous rules,
and lets normal matching, tag closure and provenance run.  `annotateAsync` is
the annotation-only counterpart.  Always call `release()`; cached rules reject
a different text or an unprefetched parameter.

## API overview

### `FlexiMatcher`

| member | purpose |
| --- | --- |
| `matches(text, pattern, options?)` | match and return a `MatchResult` |
| `contains(text, pattern)` | whether any substring matches |
| `annotate(text, { rules })` | run annotator rules without a pattern |
| `annotateBatch(texts, { rules })` | annotate several texts; aggregate annotation usage by type |
| `compile(pattern)` | resolve a pattern once and reuse it |
| `generateSample(pattern)` | build a sample string where possible |
| `bind(name, factory)`, `unbind(name)` | manage custom rules |
| `isBoundRule(name)`, `getBoundRule(name)`, `ruleNames` | inspect rules |
| `addTagRule(tag, pattern, { identifier?, template? })` | add a grammar production |
| `addTagDefinition(tag, definition)` | add a `RuleDefinition` |
| `removeTagRule(tag, id)`, `clearTags()` | manage tags |
| `tagNames`, `tagDefinitions(tag)`, `getTagRule(tag, id)` | inspect tags |
| `maximumTagNesting`, `setMaximumTagNesting(n)` | nesting guard |
| `throwOnMaxDepth`, `throwExceptionWhenReachingMaximumDepth(flag)` | error on deep recursion |

`annotate` is the annotation-only counterpart to `matches`:

```ts
const result = matcher.annotate("Le case", {
  rules: ["[it-article]", "it-noun"],
  explain: true,
  onError: "collect",
});

result.annotations; // every annotation from every rule
result.errors;      // { rule, error } entries when onError is "collect"
```

`annotateBatch` runs the same rules over a list of independent texts and
aggregates the annotations by type.  The `usage` map is the metric for "which
annotators fired" on a batch; each text still gets its own store.

```ts
const batch = matcher.annotateBatch(["Le case", "Il cane"], {
  rules: ["[it-article]", "it-noun"],
});
batch.results[0]?.store; // the first text's annotations
batch.usage["[it-noun]"]; // how many noun annotations across the batch
```

It shares one store across the rules and runs each with `matchWhole: false`.
Bare names such as `it-noun` are wrapped in brackets.  Use `matches` when you
need a full multi-chunk pattern and interpretations.

`MatchOptions`:

- `matchWhole` (default `true`) — the pattern must cover the whole text;
- `populateResult` (default `false`) — collect every interpretation;
- `fullyAnnotate` (default `false`) — annotate even after a literal chunk is
  known to be missing;
- `store` — annotate an existing `AnnotationStore`;
- `explain` — override the matcher-wide explanation setting;
- `maxInterpretations` — cap collected interpretation sequences;
- `maxAnnotations` — cap annotations in the store;
- `timeoutMs` / `signal` — cooperative time/abort budget;
- `rankInterpretation` — score function for interpretations;
- `strategy` — `all` or `best`.

Budgets throw `BudgetExceededError` for time/abort limits and set
`MatchResult.truncated` when collection is capped.  Ranking requires
`populateResult` and exposes aligned scores in `MatchResult.scores`.

### `MatchResult`

| member | purpose |
| --- | --- |
| `matching` / `isMatching` | whether the pattern matched |
| `emptyMatch` / `isEmptyMatch` | whether an empty pattern matched |
| `interpretations` | sequences of annotations, when requested |
| `truncated` | whether a limit was hit |
| `scores` | ranker scores aligned with interpretations |
| `diagnostics` | missing part, furthest end, budget constraints, tag counters, warnings |
| `store` | the annotation store used for the match |
| `matchingStrings(text)` | covered text per interpretation |
| `highlightedStrings(text)` | human-readable interpretation strings |
| `flatAnnotations()` | iterate over every annotation in every interpretation |

`MatchResult.diagnostics` explains failures and truncation:

```ts
const result = matcher.matches("abc", "ab[r:\\d+]c", {
  fullyAnnotate: true,
});
result.diagnostics.missingPart; // { index: 1, chunk: "[r:\\d+]" }
result.diagnostics.furthestEnd; // 2
result.diagnostics.tags;        // { evaluatedTags, visitedTags, maxDepth, ... }
result.diagnostics.warnings;    // truncation / depth warnings
```

### `AnnotationStore`

A store is created automatically per match, but you can pass your own to
collect every annotation a rule produced.  Annotations are deduplicated by
span, type and data.

```ts
const store = new AnnotationStore();
matcher.matches("AbC", "A[r:[bD]+]C", {
  store,
  fullyAnnotate: true,
});
console.log(store.ofType("[r:[bD]+]"));
```

`Annotation<TData>` and `store.ofType<TData>(type)` let you narrow annotation
data at the call site.  Tag productions accept an optional `schema` that
validates/coerces the generated data; see
[`docs/annotations.md`](./docs/annotations.md).

`ProvenanceGraph` builds a shared DAG from explained tag annotations, with
stable node IDs, `why()` paths and JSON/SVG export:

```ts
import { ProvenanceGraph } from "fleximatcher";

const graph = ProvenanceGraph.fromAnnotations(
  result.store.annotations,
  text,
);
graph.why(result.store.ofType("[tag:fruit]")[0]!);
graph.toSVG();
```

## Loading tags from TSV

```ts
import { readTagsFromTsv } from "fleximatcher";

readTagsFromTsv("rules.tsv", matcher);
```

Accepted columns:

| columns | fields |
| --- | --- |
| 2 | `tag`, `pattern` |
| 3 | `tag`, `pattern`, `annotation template` |
| 4 | `tag`, `pattern`, `identifier`, `annotation template` |

Blank lines and lines whose first non-space character is `#` are ignored.  A
missing identifier becomes `<dataset>_<line number>`.  An empty template column
means "no annotation".

## CLI

The package ships a small demo and one-shot matcher:

```sh
npx fleximatcher                                   # demo
npx fleximatcher "Hello world" "Hello [i:WORLD]"
npx fleximatcher --tags rules.tsv "a pear" "[tag:fruit]" --explain
npx fleximatcher "the pear" "the [i:PEAR]" --contains
```

After a local build, the same commands work with `node dist/cli.js`.

## Web playground

A small Vite + Node playground lives in `web/`.  The browser mode uses a
curated demo lexicon; the server mode loads the full Italian Wiktionary
lexicon and exposes a JSON API.

```sh
npm install
npm run build
npm --prefix web/frontend install
npm run web:build
node web/server.mjs
# http://localhost:8787
```

For development, run `node web/server.mjs` and `npm run web:dev` in two
terminals, then open <http://localhost:5173>.  See `web/README.md` for the API
shape, environment variables and lexicon generation.

When explanations are enabled, the output includes a derivation hierarchy:
a flame/icicle chart of annotation spans plus a nested tree of tag productions.
The **Try tag grammar** button loads a small `determiner` / `nominal` /
`noun-phrase` grammar to demonstrate it.

## Development

```sh
npm install
npm test
npm run typecheck
npm run lint           # Biome: lint + format check (pre-commit hook runs this)
npm run build
npm run bench          # dependency-free benchmark smoke test
```

`npm install` installs a pre-commit hook via
[simple-git-hooks](https://github.com/toplenboren/simple-git-hooks) that runs
`npm run lint`.  Apply fixes with `npm run lint:fix`; skip the hook for one
commit with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...`.

The test suite is a port of the original Java/Python tests plus coverage for
modern templates, UTF-16 offsets, store validation, recursive grammars,
seeded fuzz/property tests and diagnostics.  `npm test` includes
`test/fuzz.test.ts`; run it alone with `npm run test:fuzz`.

CI lives in `.github/workflows/ci.yml` and runs lint, typecheck, tests, the
build, the playground typecheck/build, the examples and a benchmark smoke test
on Node 25.  `npm run ci` runs the same checks locally.

The code is MIT-licensed; see [LICENSE](./LICENSE).  Generated Wiktionary
lexicons are derived data and keep their own attribution; see
[NOTICE.md](./NOTICE.md).

## Differences from the original

- TypeScript/ESM, zero runtime dependencies.
- UTF-16 code-unit offsets, native to JavaScript string slicing.
- Modern `${N}` / `${N.path}` template syntax instead of `#N#` (with native
  objects and function templates as alternatives).
- Exhaustive regex spans are still supported, with an optional `regexMaxSpan`
  guard and configurable flags.
- Tag closure is a monotone fixed point, so mutually recursive grammars work
  without deep call-stack recursion.  Compiled tag productions and `multi`
  conditions are cached lazily.
- `matcher.compile(pattern)` resolves a pattern once; it is the recommended
  fast path for large grammars and repeated matches.
- An optional `fleximatcher/wiktionary` subpath builds a compact lexicon from a
  wiktextract dump and binds POS/inflection annotators.
- A store refuses to be reused with a different text, and annotations outside
  the text are rejected.
- Empty tag productions and direct self-referential productions are rejected
  eagerly.
- Rule annotations are synchronous by design.  Remote NLP services can be
  pre-fetched with the `async` adapter and bound as cached synchronous rules.
