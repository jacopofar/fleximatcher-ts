# Wiktionary annotators

The `fleximatcher/wiktionary` module turns a
[wiktextract](https://github.com/tatuylonen/wiktextract) dump into a compact
word lexicon and exposes Italian word-class and inflection rules.  The core
matcher stays language-agnostic; this module is the Italian-first data layer.

- Node entry: `fleximatcher/wiktionary`
- Browser entry: `fleximatcher/wiktionary/browser`
- Core matcher: `fleximatcher` / `fleximatcher/browser`

## What it produces

For every surface form in the dump, the lexicon stores:

| field | example | meaning |
| --- | --- | --- |
| `word` | `case` | surface form |
| `lemma` | `casa` | canonical lemma |
| `pos` | `noun` | normalized part of speech |
| `features` | `["inflected","feminine","plural"]` | normalized feature tags |
| `gender` | `f` | derived from features |
| `number` | `p` | derived from features |
| `case` | `accusative` | derived from case features |
| `person` | `3` | derived from person features |
| `mood` | `indicative` | derived from mood features |
| `tense` | `present` | derived from tense features |
| `verbForm` | `participle` | infinitive/gerund/participle |
| `declension` | `it-noun:f` | declension/conjugation class |

Two synthetic features are added by the builder:

- `lemma` — this entry is the canonical form of its lemma;
- `inflected` — this entry is a non-lemma form.

A third, `derived`, marks forms the dump classifies as derivational,
alternative, regional, archaic, diminutive, superlative and similar.  The
tag itself is still present, so you can query both `derived` and `diminutive`.

## Building the lexicon

The builder streams the raw dump and writes gzipped NDJSON:

```sh
npm run build
node dist/wiktionary/build.js \
  --input data/raw-wiktextract-data.jsonl.gz \
  --output data/wiktionary-it.jsonl.gz \
  --language it --language-name Italian
```

The raw dump (~2.9 GB gzipped, every language of English Wiktionary) is not
committed.  Download it from kaikki.org as described in
[`tools/wiktextract/README.md`](../tools/wiktextract/README.md), which also records
the credits and the data license.

Or, after installing the package:

```sh
npx fleximatcher-wiktionary \
  --input raw-wiktextract-data.jsonl.gz \
  --output wiktionary-it.jsonl.gz \
  --language it
```

Options:

| option | default | meaning |
| --- | --- | --- |
| `--input` | required | raw wiktextract JSONL, optionally gzipped |
| `--output` | required | NDJSON output, optionally gzipped |
| `--language` | `it` | wiktextract `lang_code` to keep |
| `--language-name` | none | human-readable language name in the header |
| `--limit N` | `0` | stop after N matching entries (useful for samples) |
| `--no-derived` | off | skip entries marked `derived` |
| `--progress N` | `100000` | progress log interval in scanned lines |

The first line is a header:

```json
{"format":"fleximatcher-wiktionary-lexicon","version":1,"language":"it","languageName":"Italian","generatedAt":"..."}
```

Each following line is one compact entry:

```json
{"w":"casa","l":"casa","p":"noun","f":["lemma","feminine","singular"],"d":"it-noun:f"}
```

The artifact generated for this project at the time of writing:

- 623,477 Italian source entries;
- 1,472,922 compact entries before runtime deduplication;
- 1,469,025 entries and 1,038,884 word keys after loading;
- roughly 12 MB gzipped.

Load time is a few seconds and process memory is around 1.5 GB for the full
lexicon.  Use a POS filter when you only need some classes:

```ts
const lexicon = await loadWiktionaryLexicon("data/wiktionary-it.jsonl.gz", {
  pos: ["noun", "adj", "verb"],
});
```

## Loading

### Node

```ts
import { loadWiktionaryLexicon } from "fleximatcher/wiktionary";

const lexicon = await loadWiktionaryLexicon("data/wiktionary-it.jsonl.gz", {
  pos: ["noun", "adj", "verb", "pron", "det", "article", "contraction"],
});
```

Supported extensions: `.json`, `.json.gz`, `.jsonl`, `.jsonl.gz`,
`.ndjson`, `.ndjson.gz`.

### Browser

```ts
import {
  WiktionaryLexicon,
  type WiktionaryLexiconData,
} from "fleximatcher/wiktionary/browser";

const data: WiktionaryLexiconData = await fetch("/demo-lexicon.json").then(
  (response) => response.json(),
);
const lexicon = WiktionaryLexicon.fromData(data);
```

The browser entry deliberately has no `node:fs`/`node:zlib` dependencies.  Use
`fromData` or `fromEntries`; the full 1.5 GB lexicon is a server concern.

`fromData` also accepts the compact `{w,l,p,f,d}` entry shape.  The readable
shape `{word, lemma, pos, features, declension}` is accepted for fixtures and
hand-written lexicons.

## Registering rules

```ts
import { FlexiMatcher } from "fleximatcher";
import {
  loadWiktionaryLexicon,
  registerWiktionaryRules,
} from "fleximatcher/wiktionary";

const lexicon = await loadWiktionaryLexicon("data/wiktionary-it.jsonl.gz");
const matcher = new FlexiMatcher();
registerWiktionaryRules(matcher, lexicon, { prefix: "it" });
```

The default registration binds:

`it-noun`, `it-name`, `it-adj`, `it-verb`, `it-adv`, `it-pron`, `it-det`,
`it-article`, `it-prep`, `it-conj`, `it-intj`, `it-num`, `it-particle`,
`it-contraction`.

Options:

| option | default | meaning |
| --- | --- | --- |
| `prefix` | `lexicon.language` | rule-name prefix; empty string means no prefix |
| `includeDefaults` | `true` | bind the default rule set |
| `pos` | none | extra/override bindings, keyed by rule suffix |
| `defaultQuery` | none | query appended to every rule parameter |

Custom names:

```ts
registerWiktionaryRules(matcher, lexicon, {
  prefix: "",
  includeDefaults: false,
  pos: { nominal: ["noun", "name"] },
});

matcher.matches("Dio", "[nominal]").matching; // true
```

The lower-level factory is available when you want complete control:

```ts
import { WiktionaryRuleFactory } from "fleximatcher/wiktionary";

matcher.bind(
  "nominal",
  new WiktionaryRuleFactory(lexicon, { pos: ["noun", "name"] }),
);
```

## Query language

A rule parameter is a whitespace- or comma-separated query.  It is ANDed with
the POS implied by the rule name.

```text
[it-noun]                                  any noun
[it-noun:feminine singular]                feminine singular noun
[it-noun:gender=f number=p !derived]       feminine plural, non-derived
[it-noun:declension=it-noun:f]             -a/-e declension class
[it-verb:third-person singular present]    finite verb form
[it-verb:past participle]                  past participle
[it-pron:case=accusative]                  accusative pronoun
[it-adj:gender=m|f number=p]               masculine or feminine plural
[it-adj:superlative]                       superlative adjective
```

### Features

A bare token is a required feature tag.  Prefix it with `!` to exclude it.
Feature tags are lower-cased and normalized to kebab-case.

Useful tags:

| group | tags |
| --- | --- |
| synthetic | `lemma`, `inflected`, `derived`, `form-of`, `canonical` |
| gender | `masculine`, `feminine`, `by-personal-gender` |
| number | `singular`, `plural` |
| case | `nominative`, `genitive`, `dative`, `accusative`, `ablative`, `vocative`, `locative`, `instrumental`, `partitive`, `prepositional`, `oblique` |
| person | `first-person`, `second-person`, `third-person`, `second-person-semantically` |
| mood | `indicative`, `subjunctive`, `imperative`, `conditional` |
| tense | `present`, `imperfect`, `future`, `past`, `historic` |
| verb form | `infinitive`, `gerund`, `participle` |
| derivation | `diminutive`, `augmentative`, `pejorative`, `derogatory`, `superlative`, `comparative` |
| register/variant | `alternative`, `archaic`, `obsolete`, `rare`, `uncommon`, `regional`, `dialectal`, `poetic`, `literary`, `colloquial`, `informal`, `slang`, `vulgar`, `figuratively`, `idiomatic`, `misspelling`, `apocopic` |
| lexical | `transitive`, `intransitive`, `ambitransitive`, `impersonal`, `pronominal`, `reflexive`, `negative`, `formal`, `auxiliary` |

The list is not closed: any tag present in the dump becomes a feature.

### Structured fields

| field | accepted values | notes |
| --- | --- | --- |
| `gender` | `m`, `f`, `mf`, `masculine`, `feminine` | `m`/`f` match `mf` entries too |
| `number` | `s`, `p`, `singular`, `plural` | `s`/`p` match `sp` entries too |
| `case` | case tag | normalized feature |
| `person` | `1`, `2`, `3`, `first-person`, … | normalized |
| `mood` | mood tag | normalized feature |
| `tense` | tense tag | normalized feature |
| `verbForm` | `infinitive`, `gerund`, `participle` | aliases `vform`, `verb-form`, `verbform`, `form` |
| `declension` | exact class string, case-insensitive | e.g. `it-noun:f` |
| `pos` | normalized POS | e.g. `noun`, `adj`, `verb` |
| `lemma` | lemma string | normalized for lookup |
| `feature` | any feature tag | explicit feature check |

Alternatives inside one field use `|`:

```text
[it-adj:gender=m|f number=p]
[it-verb:tense=present|imperfect]
```

Exclusions work for fields too:

```text
[it-noun:!gender=m]
```

Unknown field names and invalid values throw a `PatternError`.

### Declension and conjugation classes

`declension` is extracted from Italian head templates:

| class | example |
| --- | --- |
| `it-noun:f` | `casa` |
| `it-noun:m` | `uomo` |
| `it-name:m` | proper noun |
| `it-adj` | adjective |
| `it-adj-sup` | superlative adjective page |
| `it-verb:a/@` | first-conjugation verb |
| `it-pp` | past participle page |
| `it-adv` | adverb |
| `it-det` | determiner |
| `it-pron-adj` | pronominal adjective |
| `it-pos:article`, `it-pos:preposition`, … | generic head template |

Forms inherit the declension when it is available from the source entry; the
loader merges entries that differ only in whether the class is known.

## Annotation data

A Wiktionary rule adds data like:

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

Fields with no value are omitted.  `word` is the surface text covered by the
annotation; `canonical` is the lexicon entry's recorded spelling.

Tag templates can read these fields:

```text
noun-phrase  [tag:determiner] [tag:nominal]  id_np
{"determiner":"${0.word}","noun":"${2.lemma}"}
```

The index `2` in that example is deliberate: the pattern has three chunks —
determiner, the literal space, nominal.  Annotation template indices always
count **pattern chunks**, including literals.

## Tokenization and normalization

The rule tokenizes text with a Unicode letter regex and keeps internal
apostrophes.  It emits both the whole run and the apostrophe-separated pieces:

```text
L'uomo        → L'  +  uomo
dell'acqua    → dell' + acqua
un'altra      → un' + altra
po'           → po'
```

Lexicon lookup normalizes with `normalizeWordKey`:

- Unicode NFC;
- curly apostrophes (`’`, `‘`, `ʼ`) become `'`;
- trim and lower-case.

The original surface text is preserved in the annotation's `word` field.
Punctuation and whitespace are not tokenized.

## Data pipeline details

The builder transforms each wiktextract entry:

1. Skips entries with no word/POS, whitespace in the word, or no letters
   (punctuation-only entries).  Multiword phrases are skipped because the
   tokenizer annotates single words.
2. Reads `form_of` references.  A form-of entry uses the referenced word as
   its lemma; descriptions with spaces (for example `"the article i"`) are
   discarded.
3. Merges head-template features, sense tags and form tags.
4. Applies override groups so a form's gender/number/case/person/mood/tense
   replaces the lemma's corresponding feature instead of accumulating both.
5. Adds `lemma` to canonical entries and `inflected` to forms.
6. Adds `derived` when a form carries a non-core/derivational/register tag, or
   when a noun form changes gender.
7. Skips table markers (`table-tags`, `inflection-template`) and auxiliary
   markers (`auxiliary`) so they do not become lexical forms.
8. Emits one compact entry per surface form, lemma and feature set.

Some feature inference is heuristic:

- a masculine singular lemma is assumed for adjectives when a distinct feminine
  form exists;
- determiners/articles get a singular default when the dump does not state a
  number;
- `it-pron-adj` entries are treated like adjectives;
- noun gender comes from `it-noun` / `it-proper noun` head arguments.

These heuristics make queries useful, but the raw feature tags remain in
`features` for exact inspection.

## Use cases

### Highlight word classes in a text

```ts
const matcher = new FlexiMatcher();
registerWiktionaryRules(matcher, lexicon, { prefix: "it" });

const text = "Le case sono belle.";
const result = matcher.annotate(text, {
  rules: ["[it-noun]", "[it-adj]", "[it-verb]"],
  onError: "collect",
});
const store = result.store;
```

### Lemma concordance

```ts
const rows = store.annotations
  .filter((annotation) => annotation.type.startsWith("[it-"))
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
      features: data.features?.join(" "),
    };
  });
```

### Morphological search

```ts
matcher.matches("case", "[it-noun:feminine plural]").matching; // true
matcher.matches("dà", "[it-verb:third-person singular present indicative]").matching; // true
matcher.matches("dato", "[it-verb:past participle]").matching; // true
matcher.matches("liberissima", "[it-adj:superlative]").matching; // true
matcher.matches("lo", "[it-pron:case=accusative]").matching; // true
```

### Agreement checking

Pattern matching returns interpretations; compare the data of an article and a
noun:

```ts
function compatible(
  article: { gender?: string; number?: string },
  noun: { gender?: string; number?: string },
): boolean {
  const genderOk =
    article.gender === noun.gender ||
    article.gender === "mf" ||
    noun.gender === "mf" ||
    article.gender === undefined ||
    noun.gender === undefined;
  const numberOk =
    article.number === noun.number ||
    article.number === undefined ||
    noun.number === undefined;
  return genderOk && numberOk;
}

const result = matcher.matches("Le case", "[it-article] [it-noun]", {
  populateResult: true,
});
const agrees = result.interpretations?.some((sequence) => {
  const article = sequence.find((ann) => ann.type.startsWith("[it-article]"));
  const noun = sequence.find((ann) => ann.type.startsWith("[it-noun]"));
  return (
    article !== undefined &&
    noun !== undefined &&
    compatible(article.data as any, noun.data as any)
  );
});
```

This is a lexical agreement check, not a full parser.  Homographs can produce
several interpretations; `some` means "at least one reading agrees".

### Noun-phrase grammar

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
  template: { determiner: "${0.word}", noun: "${1.lemma}" },
});

const result = matcher.matches("Le case", "[tag:noun-phrase]", {
  explain: true,
  populateResult: true,
});
```

With `explain: true`, the resulting annotation carries the full derivation
tree described in [annotations.md](./annotations.md).

### Explainable derivation

```ts
const tag = result.interpretations?.[0]?.at(-1);
const explain = (tag?.data as any)?.__explain;

function print(node: any, depth = 0): void {
  if (!node) return;
  console.log(`${"  ".repeat(depth)}${node.id ?? "(root)"}`);
  for (const child of node.children ?? []) {
    console.log(`${"  ".repeat(depth + 1)}${child.type} [${child.start}:${child.end}]`);
    print(child.__explain, depth + 1);
  }
}

print(explain);
```

## Limitations

- **Context-free lexicon matching.** A word is annotated according to its
  lexicon entries, not sentence context.  Homographs produce multiple
  annotations; a POS tagger or a tag grammar can disambiguate.
- **No sense disambiguation.**  Sense-level data is not part of the compact
  entry.  Multiple POS/lemma variants are retained.
- **Proper-noun case is insensitive.**  Lookup is case-insensitive so
  sentence-initial capitalization works; a lowercase common word can match a
  name entry if the lexicon has the same normalized key.
- **Single-word tokenization.**  Multiword and prepositional-phrase entries are
  skipped.  Italian elisions are split into useful pieces, but clitics attached
  to verbs are not segmented further.
- **Version-dependent data.**  The artifact reflects the dump used to build it.
  Rebuild after updating wiktextract.
- **Memory.**  The full lexicon is large.  Use the POS filter or the browser
  demo lexicon for lightweight contexts.

## Server and playground

The `web/` playground loads the full lexicon on the server and exposes:

- `GET /api/health`
- `GET /api/rules`
- `POST /api/annotate`

See [playground.md](./playground.md) for the request/response contract and the
flame hierarchy UI.
