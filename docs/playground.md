# Web playground

The `web/` folder contains a small Vite + Node playground for exploring
annotations without writing code.  It has two runtimes:

- **Client demo** — a curated Italian lexicon (5,364 words / 7,399 entries) is
  bundled into the browser.  Everything runs locally.
- **Wiktionary server** — a Node process loads the full generated lexicon
  (1,038,884 words / 1,469,025 entries) and runs the same rules server-side.

Both modes expose the same controls and result views.

## Running

### Production-style

```sh
npm install
npm run build
npm --prefix web/frontend install
npm run web:build
node web/server.mjs
# http://localhost:8787
```

Or in one command:

```sh
npm run web:start
```

`web:start` builds the library, builds the frontend and starts the server.

### Development

Terminal 1 — API server:

```sh
npm run build
node web/server.mjs
```

Terminal 2 — Vite dev server, with `/api` proxied to port 8787:

```sh
npm run web:dev
# http://localhost:5173
```

Useful root scripts:

| script | action |
| --- | --- |
| `npm run web:install` | install frontend dependencies |
| `npm run web:dev` | Vite dev server |
| `npm run web:build` | build frontend to `web/frontend/dist` |
| `npm run web:typecheck` | TypeScript check for the frontend |
| `npm run web:server` | build library and start the server |
| `npm run web:start` | build everything and start the server |

### Environment

| variable | default | meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `WIKTIONARY_LEXICON` | `data/wiktionary-it.jsonl.gz` | full lexicon path |

If the lexicon is absent, the server still starts; `/api/health` returns
`lexicon: null` and the client demo still works.

## UI controls

### Text

The textarea at the top holds the text to annotate.  **Sample** restores the
Italian sample sentence; **Clear** empties text, pattern and annotator
selection.

### Annotators

Chips toggle complete rule chunks:

- word classes: noun, proper noun, adjective, verb, adverb;
- function words: article, contraction, preposition, conjunction, pronoun,
  determiner, numeral;
- built-ins: any word (`[r:[\p{L}]+]`), number (`[r:\d+(?:[.,]\d+)?]`).

The **custom chunk** input accepts any chunk.  If omitted, brackets are added:

```text
it-noun:feminine plural   →  [it-noun:feminine plural]
[r:[A-Z][a-z]+]           →  [r:[A-Z][a-z]+]
[or:[i:cat]|[i:dog]]      →  unchanged
[repeat:[i:ha]]           →  unchanged
```

Each selected annotator is run independently against the text with
`matchWhole: false` and `fullyAnnotate: true`, sharing one annotation store.
The result is the union of all annotations.

### Pattern

An optional pattern such as:

```text
Le [it-noun:feminine plural] sono [it-adj:feminine plural]
```

The pattern runs against the same store.  With **whole text** enabled, the
pattern must cover the full text; otherwise any substring may match.  The
**Interpretations** panel then shows every annotation sequence.

**Explain tags** makes tag annotations record `data.__explain`; this is what
enables the derivation hierarchy.

### Tag rules (TSV)

The collapsible section accepts 2/3/4-column TSV:

```text
tag<TAB>pattern<TAB>identifier<TAB>template
```

For example:

```text
fruit	pear	id_pear	{"name":"pear"}
fruit	a [tag:fruit]	id_a_fruit	{"article":"${0}","inner":"${1.name}"}
```

The template is passed to the library as a string template.  Tag definitions
are added to a fresh matcher on every run, so edits take effect immediately.

A file picker loads a `.tsv`/`.txt` file into the same textarea.

### Lexicon (client mode)

A `.json` file can replace the bundled demo lexicon.  The file may use the
compact `{w,l,p,f,d}` format or the readable
`{word,lemma,pos,features,declension}` format.  After loading, the rule prefix
comes from the lexicon's `language` field.  The full 12 MB gzipped artifact is
intended for server mode, not the browser.

### Run

**Annotate** or `Ctrl/⌘ + Enter` runs the current annotation and pattern
configuration.  Errors are shown in a red panel; partial results remain
visible.

## Result views

### Annotated text

The text is split at annotation boundaries.  Each segment receives a blend of
the active annotation colors.  Overlapping annotations visibly stack.  Clicking
a segment selects its first annotation.

### Annotations

The list shows each annotation:

- type and covered text;
- start/end offsets;
- lemma, POS, gender, number, case, person, mood, tense, verb form and
  declension when present;
- feature chips;
- a **derivation breadcrumb** when the annotation participates in a tag
  derivation, e.g. `[tag:noun-phrase] › [tag:determiner] › [it-article]`;
- a **why?** disclosure with every root-to-node path when the annotation is
  shared across derivations;
- raw JSON under **data**.

Clicking a card highlights the corresponding text span and the matching flame
bar and hierarchy tree node.  Clicking a bar or tree node does the same in the
other direction.  Plain-text literal chunks are filtered out; this list is
about rule annotations.

### Export

**Export JSON** downloads the current text, pattern, selected annotators, TSV
tag source, full result and the provenance DAG.  **SVG** and **PNG** download
the provenance graph itself (the PNG is rasterized from the generated SVG).

```json
{
  "format": "fleximatcher-playground-run",
  "version": 1,
  "text": "...",
  "pattern": "...",
  "annotators": ["[it-noun]"],
  "tags": "...",
  "result": { "annotations": [], "interpretations": [] },
  "provenance": { "format": "fleximatcher-provenance", "nodes": [], "edges": [] }
}
```

Use these to share a run, file a regression, replay it in a script or drop the
derivation graph into documentation.

### Interpretations

When a pattern is present, each interpretation is a card with:

- the covered text;
- a sequence of annotation chips;
- the data of the sequence.

Clicking a chip focuses the matching annotation card.

### Derivation hierarchy

This is the feature that shows annotations built from other annotations.

- **Flame/icicle chart** — each bar is an annotation over its text span.
  Deeper rows are derived from the row above; bar width is the text span.
  The ruler above the chart displays one cell per character (`·` for spaces).
- **Derivation tree** — the same hierarchy as nested nodes, with the covered
  text and the production identifier (`via id_np`).

The hierarchy is built from tag annotations' `data.__explain`:

```json
{
  "__explain": {
    "id": "id_np",
    "children": [
      { "start": 0, "end": 2, "type": "[tag:determiner]", "__explain": { ... } },
      { "start": 3, "end": 7, "type": "[tag:nominal]", "__explain": { ... } }
    ]
  }
}
```

Click a bar or tree node to focus the corresponding annotation and text span.
Narrow bars may clip their labels; their tooltip and the tree node provide the
full type and span.

If no `__explain` data is present, the section falls back to **pattern
composition**: a synthetic `match` root with its annotation sequence.  The note
explains that this is not a causal tag derivation and that **explain tags**
should be enabled for the full hierarchy.

### Try tag grammar

The **Try tag grammar** button:

1. sets the sample text if the textarea is empty;
2. loads a small `determiner` / `nominal` / `noun-phrase` grammar;
3. enables **explain tags**;
4. sets the pattern to `[tag:noun-phrase]`;
5. adds `[tag:noun-phrase]` as a custom annotator;
6. runs.

The grammar demonstrates a three-level derivation:

```text
determiner   => [it-article]
determiner   => [it-contraction]
nominal      => [it-noun]
noun-phrase  => [tag:determiner] [tag:nominal]
noun-phrase  => [tag:determiner][tag:nominal]
noun-phrase  => [tag:nominal]
```

The spaced production uses `${2.lemma}` because the pattern has a literal space
at index 1; the unspaced production uses `${1.lemma}`.  That indexing rule is
important for tag templates.

## API

### `GET /api/health`

```json
{
  "ok": true,
  "version": "0.1.0",
  "lexicon": {
    "language": "it",
    "languageName": "Italian",
    "words": 1038884,
    "entries": 1469025
  },
  "lexiconError": null
}
```

### `GET /api/rules`

Returns the server-side annotator descriptors:

```json
{
  "annotators": [
    { "name": "it-noun", "label": "Noun", "group": "Word classes" }
  ],
  "version": "0.1.0"
}
```

### `POST /api/annotate`

Request:

```json
{
  "text": "Le case sono belle",
  "annotators": ["[it-noun]", "[it-adj]"],
  "pattern": "Le [it-noun:feminine plural] sono [it-adj:feminine plural]",
  "tags": [],
  "options": {
    "matchWhole": false,
    "explain": false
  }
}
```

`tags` entries have `tag`, `pattern`, `identifier` and optional `template`.
`text` is limited to 50,000 characters; annotators to 50 entries; tags to 100.
The request body is limited to 2 MB.

Response:

```json
{
  "source": "server",
  "annotations": [
    {
      "start": 3,
      "end": 7,
      "type": "[it-noun:feminine plural]",
      "covered": "case",
      "data": {
        "lemma": "casa",
        "pos": "noun",
        "number": "p"
      }
    }
  ],
  "interpretations": [],
  "matching": true,
  "elapsedMs": 4,
  "errors": []
}
```

`errors` contains per-annotator or pattern errors; a bad request returns HTTP
400 with `{ "error": "..." }`.

## Demo lexicon

The browser bundle uses `web/frontend/src/demo-lexicon.json`, generated by:

```sh
node web/generate-demo-lexicon.mjs \
  data/wiktionary-it.jsonl.gz \
  web/frontend/src/demo-lexicon.json
```

The generator selects a curated set of common Italian lemmas and includes all
their forms, plus function words.  It is deliberately independent of the raw
2.8 GB dump so the frontend build is reproducible from a small committed file.

## Files

| path | purpose |
| --- | --- |
| `web/server.mjs` | Node HTTP API and static file server |
| `web/frontend/index.html` | Vite entry page |
| `web/frontend/src/main.ts` | UI state, annotation runs, flame/tree rendering |
| `web/frontend/src/style.css` | visual design and hierarchy styling |
| `web/frontend/src/demo-lexicon.json` | bundled browser lexicon |
| `web/generate-demo-lexicon.mjs` | demo lexicon generator |
| `web/README.md` | short playground README |

## Limitations

- The playground is a showcase, not a hardened service.  It runs user-provided
  regex patterns and tag rules; use a sandbox/rate limit in a public
  deployment.
- The full server lexicon uses around 1.5 GB of memory.
- The flame chart is optimized for readable short texts; very long texts hide
  the character ruler and labels on narrow spans are clipped.
- The client demo lexicon is curated; it will not know every Italian word.
  Switch to server mode for the full lexicon.
