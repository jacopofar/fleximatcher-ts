# Fleximatcher web playground

A small, dependency-light playground for building and inspecting annotations.

The full reference for this app is [`../docs/playground.md`](../docs/playground.md).
Annotation semantics are in [`../docs/annotations.md`](../docs/annotations.md)
and the Wiktionary rules in [`../docs/wiktionary.md`](../docs/wiktionary.md).

There are two modes:

- **Client demo** — runs entirely in the browser with a curated Italian
  lexicon (`frontend/src/demo-lexicon.json`, about 7,400 entries).
- **Wiktionary server** — the Node server loads the full generated lexicon
  (`data/wiktionary-it.jsonl.gz`, about 1.47M entries) and runs the same rules
  server-side.

The UI lets you write text, toggle annotators, add custom annotator chunks,
write a pattern, paste TSV tag definitions, and see highlighted spans,
annotation data and pattern interpretations.

## Derivation hierarchy

Tag annotations carry an `__explain` field when **explain tags** is enabled.
The playground turns that into:

- a **flame/icicle chart** where each bar is an annotation span and deeper rows
  are derived from the row above;
- a nested **derivation tree** with the production identifier and covered text.

Click a bar or tree node to focus the corresponding annotation and text span.
Annotation cards show a derivation breadcrumb when they participate in a tag
derivation, and a **why?** disclosure lists every root-to-node path when the
annotation is shared across derivations. The **Export JSON** button downloads
the current run plus the provenance DAG; **SVG** and **PNG** export the DAG
itself.

Without explanations, the hierarchy shows pattern composition instead (a
`match` root with its annotation sequence). The **Try tag grammar** button
loads a small `determiner` / `nominal` / `noun-phrase` grammar so the full
tag-derivation hierarchy is visible immediately.

## Run it

Build the library and the frontend:

```sh
npm install
npm run build
npm --prefix web/frontend install
npm run web:build
```

Start the Node server:

```sh
node web/server.mjs
```

Then open <http://localhost:8787>.

The client demo works immediately. The server mode requires the full lexicon.
Generate it from the wiktextract dump with:

```sh
npm run build
node dist/wiktionary/build.js \
  --input ../wiktionary-web/raw-wiktextract-data.jsonl.gz \
  --output data/wiktionary-it.jsonl.gz \
  --language it --language-name Italian
```

## Development

Terminal 1 — API server:

```sh
npm run build
node web/server.mjs
```

Terminal 2 — Vite dev server with `/api` proxied to port 8787:

```sh
npm run web:dev
```

Open <http://localhost:5173>.

Useful scripts from the repository root:

```sh
npm run web:install    # install frontend dependencies
npm run web:dev        # Vite dev server
npm run web:build      # build frontend to web/frontend/dist
npm run web:typecheck  # TypeScript check for the frontend
npm run web:server     # build the library and start the server
npm run web:start      # build everything and start the server
```

## Environment

| variable | default | purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `WIKTIONARY_LEXICON` | `data/wiktionary-it.jsonl.gz` | full lexicon path |

If the lexicon is missing, the API still starts and the client demo still
works; server health reports `lexicon: null`.

## API

- `GET /api/health` — server version and lexicon stats.
- `GET /api/rules` — the annotator descriptors.
- `POST /api/annotate` — annotate text.

Request body:

```json
{
  "text": "Le case sono belle",
  "annotators": ["[it-noun]", "[it-adj]"],
  "pattern": "Le [it-noun:feminine plural] sono [it-adj:feminine plural]",
  "tags": [],
  "options": { "matchWhole": false, "explain": false }
}
```

Response:

```json
{
  "source": "server",
  "matching": true,
  "annotations": [
    {
      "start": 3,
      "end": 7,
      "type": "[it-noun:feminine plural]",
      "covered": "case",
      "data": { "lemma": "casa", "pos": "noun", "number": "p" }
    }
  ],
  "interpretations": [],
  "elapsedMs": 4,
  "errors": []
}
```

Tags use the same 2/3/4-column TSV shape as the library:

```text
tag<TAB>pattern<TAB>identifier<TAB>template
```

## Demo lexicon

`frontend/src/demo-lexicon.json` is generated from the full artifact with:

```sh
node web/generate-demo-lexicon.mjs \
  data/wiktionary-it.jsonl.gz \
  web/frontend/src/demo-lexicon.json
```

It contains a curated set of common Italian lemmas and their inflected forms.
The generator is intentionally separate so the browser bundle stays independent
of the 2.8 GB raw dump.
