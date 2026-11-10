# Annotations and matching

This document describes the core model: what an annotation is, how annotations
are stored, how patterns become matches, how rules add annotations and how tag
derivations are represented.

## Annotations

An annotation is an immutable span of text:

```ts
import { Annotation } from "fleximatcher";

const annotation = new Annotation(
  4,        // start
  8,        // end (exclusive)
  "[i:DOG]",// type: the pattern chunk that produced it
  { lemma: "dog" }, // optional JSON-like data
);
```

Fields:

| field | meaning |
| --- | --- |
| `start` | zero-based start offset |
| `end` | zero-based exclusive end offset |
| `type` | the rule chunk that produced the annotation |
| `data` | optional JSON-like metadata |
| `key` | a deterministic hashable identity used for deduplication |

Offsets count **UTF-16 code units**, the same units as `String.prototype.slice`.
An emoji therefore spans two units.  `end` must be greater than `start`;
zero-length annotations are not meaningful and `Annotator.add` silently
discards them.

`coveredText(text)` returns the substring for the span.  `toJSON()` returns
`{ start, end, type, data }`, which is convenient for transport.

## Annotation stores

Rules do not return a list of annotations.  They write into an
`AnnotationStore`:

```ts
import { AnnotationStore } from "fleximatcher";

const store = new AnnotationStore({ text });
store.addAnnotation(0, 3, "[i:the]");
store.addAnnotation(4, 7, "[i:dog]", { lemma: "dog" });
```

A store:

- deduplicates by start, end, type and structural data;
- indexes annotations by start position and by type;
- holds an optional **text** and refuses to attach a different one;
- carries an `explain` flag and an internal `extras` map for cooperating
  algorithms such as the tag closure.

Useful methods:

| method/property | meaning |
| --- | --- |
| `add(annotation)` | add an annotation, return whether it was new |
| `addAnnotation(start, end, type, data?)` | create and add |
| `at(start)` | annotations starting at a position |
| `ofType(type)` | annotations with an exact type |
| `has(start, end, type)` | whether that span/type exists |
| `starts` | positions where annotations start |
| `annotations` | all annotations in insertion order |
| `size` / `length` | number of annotations |
| `text` | the attached text, or `null` |
| `explain` | whether tag annotations include `__explain` |
| `extras` | internal scratch space for cooperative algorithms |

A store belongs to one text.  Reusing it with a different text throws:

```ts
const store = new AnnotationStore({ text: "a" });
store.attachText("b"); // RuleError: belongs to a different text
```

You normally let `FlexiMatcher.matches` create one store per match.  Pass your
own store when you want to collect annotations across several annotator/pattern
calls on the same text.

## Patterns

A pattern alternates literal text and rule chunks:

```text
the [i:dog] eats a [r:[A-Za-z]+]
```

`splitPattern` preserves every character:

```ts
import { splitPattern } from "fleximatcher";

splitPattern("the dog [i:eats] the pear");
// ["the dog ", "[i:eats]", " the pear"]
```

`[name:parameter]` invokes the rule bound to `name`.  The parameter is
everything after the first colon, including spaces.  Square brackets may nest
for rules such as `multi`.

## Matching is sequence search

Each rule annotates the text independently.  Matching then searches for
consecutive spans whose types are exactly the pattern chunks, in order:

```text
pattern:  "Le "  [it-noun]  " sono "  [it-verb]
text:        0..3    3..7       7..13    13..17
```

The sequence must be contiguous.  With `matchWhole: true` (the default) the
first annotation starts at `0` and the last ends at `text.length`.  With
`matchWhole: false` any contiguous substring may match.

```ts
matcher.matches("the dog", "the [i:DOG]").matching;   // true
matcher.matches("xx the dog", "the [i:DOG]").matching; // false
matcher.contains("xx the dog", "the [i:DOG]");         // true
```

## Match results and interpretations

`matches` returns a `MatchResult`:

```ts
const result = matcher.matches(
  "Le case sono belle",
  "Le [it-noun:feminine plural] sono [it-adj:feminine plural]",
  { populateResult: true },
);

result.matching;       // true
result.interpretations; // one or more annotation sequences
result.store;          // the annotated store
```

Options:

| option | default | meaning |
| --- | --- | --- |
| `matchWhole` | `true` | require the pattern to cover the whole text |
| `populateResult` | `false` | collect all interpretation sequences |
| `fullyAnnotate` | `false` | keep annotating even after a literal chunk is known to be missing |
| `store` | new store | annotate an existing store instead of creating one |
| `explain` | matcher default | include `__explain` in tag annotations |
| `maxInterpretations` | unlimited | stop collecting interpretation sequences after N |
| `maxAnnotations` | unlimited | discard annotations after N and set `truncated` |
| `timeoutMs` | none | cooperative wall-clock deadline |
| `signal` | none | cooperative abort signal |
| `rankInterpretation` | none | score function for interpretations |
| `strategy` | `all` | `all` or `best` (requires a ranker) |

`fullyAnnotate` is useful when you want the store to contain everything rules
can produce, even if the match is already impossible.

Helpers on `MatchResult`:

| member | meaning |
| --- | --- |
| `matching` / `isMatching` | whether the pattern matched |
| `emptyMatch` / `isEmptyMatch` | whether the pattern was empty |
| `interpretations` | every annotation sequence, when requested |
| `truncated` | whether annotation/interpretation collection hit a limit |
| `scores` | ranker scores aligned with `interpretations` |
| `matchingStrings(text)` | covered text per interpretation |
| `highlightedStrings(text)` | human-readable per-annotation strings |
| `flatAnnotations()` | iterate over every annotation in every interpretation |

Interpretations are deduplicated.  With `matchWhole: true`, only sequences whose
last annotation ends exactly at the text end are returned.

## Budgets and ranking

Large or ambiguous grammars can produce many annotations and interpretations.
Budgets are cooperative: the engine checks them at rule boundaries and in the
main sequence/tag loops.

```ts
const controller = new AbortController();

const result = matcher.matches(text, pattern, {
  populateResult: true,
  maxInterpretations: 200,
  maxAnnotations: 20_000,
  timeoutMs: 2_000,
  signal: controller.signal,
  rankInterpretation: (sequence) => sequence.length,
  strategy: "best",
});

if (result.truncated) {
  // collection was capped; matching itself may still have succeeded
}
```

- `maxInterpretations` truncates the collected result, not the sequence search.
- `maxAnnotations` makes the store discard new annotations and set
  `store.truncated`.
- `timeoutMs` and `signal` throw a `BudgetExceededError` (`reason: "timeout"`
  or `"aborted"`).  A single runaway regex or user function cannot be
  interrupted by JavaScript, but built-in loops and tag closure cooperate.
- `rankInterpretation` sorts interpretations by score.  `strategy: "best"`
  keeps only the highest-scoring ones.  Scores appear in `result.scores`.
- `AnnotateResult` also has `truncated` for annotation-only runs.

Budgets are also accepted by `annotate()`.

## Diagnostics

Every `MatchResult` carries a `diagnostics` object explaining what happened:

```ts
const result = matcher.matches("abc", "ab[r:\\d+]c", {
  fullyAnnotate: true,
});

result.diagnostics.missingPart; // { index: 1, chunk: "[r:\\d+]" }
result.diagnostics.furthestEnd; // 2
result.diagnostics.warnings;    // []
```

| field | meaning |
| --- | --- |
| `missingPart` | the first part with no candidate annotation, or `null` |
| `furthestEnd` | furthest text position reached by a complete part prefix |
| `interpretations` | number of collected interpretation sequences |
| `truncated` | whether a budget capped annotation or interpretation collection |
| `constraints` | `maxInterpretations`, `maxAnnotations`, `timeoutMs`, `aborted` |
| `tags` | tag-closure counters (`evaluatedTags`, `visitedTags`, `maxDepth`, `prunedByDepth`, `opaqueTags`) |
| `warnings` | human-readable messages derived from the counters |

Tag diagnostics are also available directly from a store:

```ts
import { tagDiagnosticsOf } from "fleximatcher";

tagDiagnosticsOf(result.store);
```

Warnings are emitted when annotations were truncated, tag productions were
pruned at the maximum nesting depth, or opaque tag rules were re-evaluated
conservatively.  `annotate()` does not build a `MatchResult`; its
`AnnotateResult.truncated` flag covers annotation-level truncation.

## Typed data and schemas

`Annotation<TData>` is generic over its data.  `AnnotationStore.ofType` can
narrow the annotation data type at the call site:

```ts
import { Annotation, type AnnotationSchema } from "fleximatcher";

const schema: AnnotationSchema<{ value: number }> = (raw) => {
  const value = (raw as { value?: unknown }).value;
  if (typeof value !== "number") {
    throw new Error("expected a numeric value");
  }
  return { value };
};

matcher.addTagRule<{ value: number }>("number", "[r:\\d+]", {
  identifier: "id_number",
  template: ({ covered }) => ({ value: Number(covered(0)) }),
  schema,
});

const result = matcher.matches("42", "[tag:number]", {
  populateResult: true,
});
const data = result.store
  .ofType<{ value: number }>("[tag:number]")[0]?.data;
data?.value; // number
```

- `AnnotationTemplate<TData>` and `RuleDefinition<TData>` carry the same type.
- A schema runs after the template is expanded.  It can validate, coerce or
  throw; schema failures become `AnnotationError`.
- The store remains heterogeneous because it collects data from many rules;
  use `ofType<TData>` where you know the shape.


## Annotation-only runs

You do not need a pattern to collect annotations.  `annotate` runs each rule
over the text with `matchWhole: false`, shares one store and returns the union:

```ts
const result = matcher.annotate("Le case", {
  rules: ["[it-article]", "it-noun"],
  explain: true,
  onError: "collect",
});

result.store;        // the shared AnnotationStore
result.annotations;  // every annotation from every rule
result.errors;       // [{ rule, error }] when onError is "collect"
```

- `rules` accepts rule chunks, bare rule names (`it-noun`) and
  `CompiledPattern` instances.
- `onError: "throw"` (the default) stops at the first failure;
  `onError: "collect"` records the failure and continues.
- `fullyAnnotate` defaults to `true` for annotate-only runs.
- Use `matches` for multi-chunk patterns and interpretations.

### Batches and rule usage

`annotateBatch` runs the same rules over several independent texts and
aggregates the annotations by type.  Each text gets its own store; the `usage`
map answers "which annotators fired, and how often" without the caller
reimplementing the loop:

```ts
const batch = matcher.annotateBatch(["Le case", "Il cane"], {
  rules: ["[it-article]", "it-noun"],
  onError: "collect",
});

batch.results[0]?.store.ofType("[it-noun]");
batch.usage["[it-noun]"]; // annotations of that type across the batch
```

`collectUsage: false` skips the map.  `AnnotationStore.usage()` exposes the
same counts for a single store, including tag annotations added by the tag
closure.

## Rules and custom annotators

A rule implements `annotate(text, annotator)`.  It adds spans through the
annotator and returns an advisory boolean:

```ts
import type { Rule, RuleFactory } from "fleximatcher";
import type { Annotator } from "fleximatcher";

class SlangFactory implements RuleFactory {
  getRule(parameter: string): Rule {
    const accepted = new Set(parameter.split(",").map((value) => value.trim()));
    return {
      annotate(text, annotator) {
        for (const word of accepted) {
          let start = 0;
          while (true) {
            const index = text.indexOf(word, start);
            if (index === -1) break;
            annotator.add(index, index + word.length, { slang: true });
            start = index + 1;
          }
        }
        return false;
      },
    };
  }

  generateSample(parameter: string): string | null {
    return parameter.split(",")[0]?.trim() ?? null;
  }
}

matcher.bind("slang", new SlangFactory());
matcher.matches("that is rad", "that is [slang:rad]").matching; // true
```

Rules should be:

- **synchronous** — the engine has no async matching;
- **stateless or reusable** — compiled patterns reuse rule instances;
- **pure with respect to text** — the same rule may be called repeatedly for
  the same text as tags reach their fixed point.

### `Annotator`

The annotator passed to a rule is bound to the chunk that invoked the rule:

```ts
annotator.type;   // e.g. "[slang:rad]"
annotator.text;   // the text being annotated
annotator.store;  // the annotation store
annotator.explain;// whether explanations are enabled
annotator.add(start, end, data?);
```

`annotator.add` automatically tags the span with `annotator.type`; a rule never
needs to know its own name.  Out-of-range spans throw a `RuleError`.

Rules can recurse into the matcher with the same store:

```ts
const sub = annotator.match(text, "[i:dog] [i:eats]", {
  matchWhole: false,
  populateResult: true,
});
```

The text must be identical to `annotator.text`; offsets are relative to one
string.  Sharing the store means sub-matches reuse annotations rather than
recomputing them.

## Pattern macros

Pattern macros are named compile-time fragments.  Define them once and reuse
them in `matches`, `compile`, `generateSample` and tag productions with
`{{name}}`:

```ts
matcher.defineMacro("article", "[or:[i:il]|[i:lo]|[i:la]|[i:i]]");
matcher.defineMacro("noun", "[it-noun]");
matcher.defineMacro("noun-phrase", "{{article}} {{noun}}");

matcher.matches("la casa", "{{noun-phrase}}").matching; // true

const compiled = matcher.compile("{{noun-phrase}}");
compiled.expandedPattern; // "[or:...] [it-noun]"
```

Macro names may contain letters, digits, `_`, `.` and `-`.  Expansion is
recursive, cycle-checked and depth-limited.  Macros are expanded at compile
time; a `CompiledPattern` keeps the expansion it was created with.

```ts
matcher.macroNames;            // ["article", "noun", "noun-phrase"]
matcher.getMacro("article");   // the definition
matcher.removeMacro("article"); // true
matcher.clearMacros();

// Define at construction time.
const configured = new FlexiMatcher({ macros: { greeting: "[i:hello]" } });
```

Macros never execute code, so they remain safe for TSV rules and the server
API.  An undefined macro throws `UnknownMacroError`; a cycle throws
`PatternError`.

## Safe pattern combinators

The core binds three declarative combinators in addition to `multi`.

### `or`

`or` takes alternatives separated by `|` at bracket depth zero:

```ts
matcher.matches("cat", "[or:[i:cat]|[i:dog]]").matching; // true
matcher.matches("the dog", "[or:[i:the] [i:dog]|[i:cat]]").matching; // true
matcher.matches("b", "[or:[r:a|b]|[i:c]]").matching; // true
```

The rule annotates the span covered by each successful alternative and records
the matching alternatives in data:

```json
{ "alternatives": ["[i:cat]", "[i:CAT]"] }
```

### `repeat`

`repeat` takes one sub-pattern and annotates every span reachable by chaining
adjacent matches:

```ts
matcher.matches("hahaha", "[repeat:[i:ha]]").matching; // true
matcher.matches("ha!ha!", "[repeat:[i:ha][i:!]]").matching; // true
```

Data records the repetition counts that produced each span:

```json
{ "repetitions": [1, 2, 3] }
```

The default enumeration cap is 16 repetitions.  Rebind `repeat` with
`new RepeatRuleFactory(matcher, { maxRepetitions: 32 })` if you need more.

### `optional`

`optional` wraps a sub-pattern that may occur zero or one time:

```ts
matcher.matches("a c", "[i:a][ws][optional:[i:b][ws]][i:c]").matching; // true
matcher.matches("a b c", "[i:a][ws][optional:[i:b][ws]][i:c]").matching; // true
```

The rule annotates every span the inner pattern matches.  The **sequence
matcher** implements the zero case: a chunk whose factory sets `optional: true`
may be skipped, and the interpretation simply continues at the same position.
This avoids zero-length annotations.

A skipped optional chunk is absent from the matched sequence, so positional
`${N}` templates in a tag production would refer to the wrong annotation.
`RuleDefinition` rejects that combination; use a function template instead:

```ts
matcher.addTagRule("kind", "[i:a][ws][optional:[i:b]]", {
  identifier: "id_kind",
  template: ({ sequence }) => ({ parts: sequence.length }),
});
```

### `ws` and `word`

`ws` annotates runs of one or more whitespace characters, including newlines.
`word` is a case-insensitive whole-word literal, so `[word:non]` does not match
inside *nonostante*.  Italian elisions are exposed as the whole run and as
their apostrophe-separated pieces.

```ts
matcher.matches("a\n\tb", "[i:a][ws][i:b]").matching; // true
matcher.contains("nonostante", "[word:non]"); // false
matcher.contains("l'uomo", "[word:uomo]"); // true
```

All three are safe strings: they are available to TSV rules and the server API
and never evaluate arbitrary code.

### Rules that read tags

If a custom rule internally calls `annotator.match(text, "[tag:...]")`, set
`usesTags: true` on its factory:

```ts
matcher.bind("delegate", {
  usesTags: true,
  getRule() {
    return {
      annotate(text, annotator) {
        const inner = annotator.match(text, "[tag:fruit]", { matchWhole: true });
        if (inner.matching) annotator.add(0, text.length, { ok: true });
        return false;
      },
    };
  },
  generateSample: () => null,
});
```

The tag closure then treats productions using that rule as opaque and
re-evaluates them when any tag annotation changes.  Pure text rules should
leave the flag off.

## Async rules

The core engine is synchronous.  External models and remote services are
usually asynchronous, so `fleximatcher/async` (also exported from the package
root) provides a prefetch adapter instead of making the matcher async:

```ts
import { FlexiMatcher, matchesAsync, type AsyncRuleFactory } from "fleximatcher";

const remotePos: AsyncRuleFactory = {
  async analyze(text, parameter) {
    const response = await fetch("https://model.example/pos", {
      method: "POST",
      body: JSON.stringify({ text, tag: parameter }),
    });
    const spans = await response.json();
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

result.matching;
result.store.ofType("[remote-pos:NOUN]");
result.release(); // restore the previous bindings
```

How it works:

1. `prefetchAsyncRules` awaits each `analyze(text, parameter)`.
2. Each async rule name is bound to a cached **synchronous** rule.
3. Normal matching runs, including tag closure, patterns and provenance.
4. `release()` restores whatever bindings existed before.  Call it in a
   `finally` block when using the low-level API; `matchesAsync` and
   `annotateAsync` attach `release()` to the result.

The cached rule rejects a different text or an unprefetched parameter with a
`RuleError`, so stale results cannot silently leak between runs.  Prefetch the
parameter set you need up front; this keeps the rest of the engine
synchronous and deterministic.

## Annotation templates

Tag productions can attach data using three forms.

### Lenient JSON string with `${...}` placeholders

```ts
matcher.addTagRule("fruit", "a [tag:fruit]", {
  identifier: "id_a_fruit",
  template: "{'article':'${0}','inner':${1.name}}",
});
```

- `${N}` inserts the text covered by the N-th pattern chunk.
- `${N.path}` reads a property from that chunk's annotation data.
- `${N.items[0]}` indexes arrays.
- In value position the value is inserted as a JSON literal.
- Inside a quoted string the value is inserted as escaped string content.

Placeholder indices count **all pattern chunks**, including literals.  In
`a [tag:fruit]`, `${1.lemma}` is the fruit because `a ` is index 0.  In
`[tag:determiner] [tag:nominal]`, the space is index 1, so the nominal is
`${2.lemma}`.

The parser accepts single quotes, unquoted keys and bare values, like the
original `org.json`-based implementation.

### Native object or array

```ts
matcher.addTagRule("fruit", "a [tag:fruit]", {
  identifier: "id_a_fruit",
  template: {
    article: "${0}",
    inner: "${1.name}",
  },
});
```

An exact placeholder preserves the original type: numbers stay numbers, arrays
stay arrays.

### Function template

```ts
matcher.addTagRule("word", "[r:[a-z]+]", {
  identifier: "id_word",
  template: ({ sequence, text, covered }) => ({
    text: covered(0),
    upper: text.slice(sequence[0].start, sequence[0].end).toUpperCase(),
  }),
});
```

Function templates must be synchronous.  They receive:

| property | meaning |
| --- | --- |
| `text` | the text being annotated |
| `sequence` | the annotations that matched the production |
| `covered(index)` | covered text of the N-th annotation |
| `value(index, path?)` | annotation data of the N-th annotation, optionally at a path |

## Explain and the derivation hierarchy

Pass `explain: true` (or set `matcher.explain = true`) to make tag annotations
record their derivation:

```ts
const result = matcher.matches("a pear", "[tag:fruit]", {
  populateResult: true,
  explain: true,
});

const fruit = result.interpretations?.[0]?.[0];
fruit?.data;
```

The data looks like this:

```json
{
  "article": "a ",
  "inner": "pear",
  "__explain": {
    "id": "id_a_fruit",
    "children": [
      {
        "start": 0,
        "end": 2,
        "type": "a "
      },
      {
        "start": 2,
        "end": 6,
        "type": "[tag:fruit]",
        "__explain": {
          "id": "id_pear",
          "children": [
            { "start": 2, "end": 6, "type": "pear" }
          ]
        }
      }
    ]
  }
}
```

- `id` is the production identifier.
- `children` lists the pattern chunks that produced the span.  Each child has
  `start`, `end`, `type` and, for nested tag annotations, its own `__explain`.
- Children do not duplicate annotation data; resolve them against the match
  store by `(start, end, type)` if you need lemma/features.

This is the data the playground renders as a **flame/icicle chart** and a
nested tree: each row is a derivation depth, and each bar is a span.  A
recursive traversal is straightforward:

```ts
function walk(explain: any, depth = 0): void {
  if (!explain) return;
  console.log(`${"  ".repeat(depth)}via ${explain.id}`);
  for (const child of explain.children ?? []) {
    console.log(`${"  ".repeat(depth + 1)}${child.type} [${child.start}:${child.end}]`);
    walk(child.__explain, depth + 1);
  }
}

walk((fruit?.data as any)?.__explain);
```

Without `explain`, tag annotations still work but the derivation tree is not
recorded.  The playground falls back to showing pattern composition: a
synthetic `match` root with its annotation sequence.

## Provenance graphs

`ProvenanceGraph` turns explained annotations into a shared DAG:

```ts
import { ProvenanceGraph } from "fleximatcher";

const graph = ProvenanceGraph.fromAnnotations(
  result.store.annotations,
  text,
);

const fruit = result.store
  .ofType("[tag:fruit]")
  .find((annotation) => annotation.start === 0);

const node = fruit === undefined ? undefined : graph.nodeFor(fruit);
const paths = fruit === undefined ? [] : graph.why(fruit);

graph.toJSON(); // { format, version, text, roots, nodes, edges }
graph.toSVG({ width: 1200 }); // standalone SVG string
```

- A child annotation shared by several parent derivations is **one node with
  multiple parents**, not a duplicated tree.
- Stable node IDs use `annotation.key` when a real annotation backs the node;
  otherwise a span/type synthetic ID is used.
- `why(target)` returns every root-to-target path.
- `fromAnnotations` accepts real `Annotation`s and structurally equivalent
  serialized annotations; literal leaf chunks are hidden by default
  (`{ includeLiterals: true }` to keep them).
- `toSVG` produces a layered DAG suitable for download or rasterization.
  The playground adds PNG export on top of it.

## Practical annotation recipes

These are small patterns; [use-cases.md](./use-cases.md) has complete scenarios.

### Collect annotations instead of matching a pattern

```ts
const text = "Le case sono belle.";
const store = new AnnotationStore({ text });
for (const chunk of ["[it-noun]", "[it-adj]", "[it-verb]"]) {
  matcher.matches(text, chunk, {
    store,
    matchWhole: false,
    fullyAnnotate: true,
  });
}
```

### Find a feature subset

```ts
const plurals = store
  .ofType("[it-noun]")
  .filter((annotation) => {
    const data = annotation.data as { number?: string };
    return data.number === "p";
  });
```

### Follow a derivation

```ts
const tag = result.interpretations?.[0]?.at(-1);
const id = (tag?.data as any)?.__explain?.id;
const childTypes = (tag?.data as any)?.__explain?.children?.map(
  (child: any) => child.type,
);
```

## Tag closure

Tags are evaluated to a monotone fixed point.  The implementation is
semi-naive: a dependency graph records which tags each production references,
and a dirty-tag worklist re-evaluates only the productions that can be affected
by a newly added annotation.  Nested tag rules register newly discovered tags
during matching; `usesTags: true` on a custom rule factory marks productions
that call `annotator.match` with tag patterns as opaque, so they are re-run
conservatively whenever a tag changes.  Pure text rules should leave the flag
off.

## Performance and memory

- The sequence search is polynomial in the number of annotations; keep stores
  scoped to one text.
- `populateResult: true` can multiply work and memory because every distinct
  interpretation is retained.  Use it for inspection, not bulk extraction.
- `fullyAnnotate: false` (the default) short-circuits when a literal chunk is
  absent.
- Regex rules search suffixes exhaustively; use `regexMaxSpan` to bound
  pathological patterns.
- Tag closure is a fixed point.  `matcher.compile` caches compiled patterns and
  rule instances.  See [wiktionary.md](./wiktionary.md) for the larger
  lexicon-specific costs.
