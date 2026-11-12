# The raw wiktextract dump

`fleximatcher/wiktionary` ships no dictionary of its own.  It reads a **raw
[wiktextract](https://github.com/tatuylonen/wiktextract) dump** — one JSON
object per line covering every language of English Wiktionary — and compacts
the language you ask for into `data/wiktionary-<lang>.jsonl.gz`.

This folder documents that input: what the file is, where to get it, what this
project reads from it, and the attribution it carries.  No third-party code is
vendored here; the dump is downloaded, not built.

## What the file is

- JSONL / NDJSON: UTF-8 text, **one JSON object per line**, no enclosing array.
- Each object is the extraction of one Wiktionary page section: `word`,
  `lang`, `lang_code`, `pos`, `senses`, `forms`, `head_templates`,
  `etymology_text`, `translations`, and so on.  The schema is defined by
  wiktextract (`wiktextract/wiktwords.py` and the documentation in its README).
- Objects with no `lang` / `word` are Wiktionary **redirects**; this project
  skips anything whose `lang_code` is not the requested language, so they
  never reach the lexicon.
- Scale for the English Wiktionary edition: roughly **2.9 GB gzipped / 24.8 GB
  uncompressed** (kaikki.org figures for the 2026-10-01 dump).  The builder
  streams the file, so memory use stays flat.

## Where to get it

1. **kaikki.org raw data page** — <https://kaikki.org/dictionary/rawdata.html>.
   Download `raw-wiktextract-data.jsonl.gz`.  The page states which enwiktionary
   dump it was extracted from and the exact wiktextract commit, and is usually
   refreshed at least weekly.
   - direct file: <https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz>
   - Italian-only extract (much smaller, same schema):
     <https://kaikki.org/dictionary/Italian/kaikki.org-dictionary-Italian.jsonl>
2. **Run wiktextract yourself** against an
   [`enwiktionary-<date>-pages-articles.xml.bz2`](https://dumps.wikimedia.org/enwiktionary/)
   dump.  This takes hours; see the upstream README for the pipeline.

Put the file in `data/`, which is gitignored:

```text
data/raw-wiktextract-data.jsonl.gz
```

`data/` also holds the compact lexicons this repo generates; see
[`data/README.md`](../../data/README.md).

## What this project reads from it

`src/wiktionary/transform.ts` only looks at the fields it needs:

| field | use |
| --- | --- |
| `word` | surface form; entries with whitespace or no letters are dropped |
| `lang_code` | `--language` filter (`it` by default) |
| `pos` | normalized to the lexicon's POS vocabulary |
| `senses[].tags` | feature tags (`feminine`, `plural`, `archaic`, …) |
| `senses[].form_of[].word` | lemma of an inflected form |
| `forms[].tags` | inflection table tags, merged into features |
| `head_templates[].name`, `.args` | declension class / gender (`it-noun`, `it-adj`, …) |

Everything else in the dump — translations, examples, etymology, anagrams,
audio, categories — is ignored.

The transform is **Italian-first**: the head-template handling knows about
`it-noun`, `it-adj`, `it-verb`, `it-pos` and friends.  Other languages can be
extracted with `--language <code>`, but they yield thinner entries because
their head templates and feature vocabulary are not mapped.

## Reproducing the shipped lexicon

From the repository root, with the raw dump in `data/`:

```sh
npm install
npm run build
node dist/wiktionary/build.js \
  --input data/raw-wiktextract-data.jsonl.gz \
  --output data/wiktionary-it.jsonl.gz \
  --language it --language-name Italian
```

To also regenerate the curated browser demo lexicon:

```sh
node web/generate-demo-lexicon.mjs \
  data/wiktionary-it.jsonl.gz \
  web/frontend/src/demo-lexicon.json
```

## Notes and caveats

- **Snapshots drift.** The dump is a point-in-time extraction; kaikki.org
  refreshes it weekly.  Two builds months apart will differ in morphology
  coverage and in the odd lemma.  The generated lexicon records its format
  version, language and `generatedAt` timestamp, but **not** which dump it came
  from — if you need provenance, keep the dump date in the file name (for
  example `data/raw-wiktextract-2026-10-01.jsonl.gz`) or note it next to the
  artifact.
- The lexicon currently in `data/` was built on 2026-11-08.  The only raw dump
  on hand was downloaded in late August 2026 — an earlier edition than the one
  kaikki.org serves today — so a rebuild against today's dump will differ
  slightly in coverage and in the odd lemma.
- The browser demo lexicon (`web/frontend/src/demo-lexicon.json`, about 7,400
  entries) is a curated subset of the same derived data and carries the same
  license, even though it is committed to the repository.
- wiktextract occasionally changes its schema (fields are added, rarely
  renamed).  `src/wiktionary/transform.ts` declares only the fields it reads,
  so new fields are harmless; a renamed field would silently reduce coverage.
  Rebuilding after a dump refresh is the quickest way to notice.
- The Italian artifact has about 1.47M surface forms in roughly 12 MB gzipped,
  so a full rebuild needs a few minutes of CPU and a few hundred MB of disk.
- The dump is an input, never a test fixture: nothing in `test/` depends on
  it, so the suite runs from a fresh clone.

## Credits

- **[wiktextract](https://github.com/tatuylonen/wiktextract)** — the extractor
  that turns Wiktionary wikitext into this JSONL format.  Written by Tatu
  Ylonen and contributors, MIT-licensed.
  If you use the data in academic work, the upstream project asks you to cite:
  Tatu Ylonen, *Wiktextract: Wiktionary as Machine-Readable Structured Data*,
  Proceedings of LREC 2022, pp. 1317-1325, Marseille.
  <http://www.lrec-conf.org/proceedings/lrec2022/pdf/2022.lrec-1.140.pdf>
- **[kaikki.org](https://kaikki.org/dictionary/)** — hosts the ready-made raw
  dump and per-language extracts; the project asks for a link back to the
  relevant kaikki.org page.
- **[Wiktionary](https://en.wiktionary.org/)** — the source corpus, a
  Wikimedia project.  Its content is dual-licensed CC BY-SA and GFDL; the
  extracted data inherits that.

## License

Two different things are at play:

- **The code here** is MIT (see [`../../LICENSE`](../../LICENSE)).  No
  wiktextract source is copied into this repository, so the MIT text is kept in
  [`LICENSE-wiktextract.txt`](./LICENSE-wiktextract.txt) for attribution only.
- **The data** is *not* MIT.  Wiktionary text is available under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) and the GNU
  Free Documentation License; dumps extracted by wiktextract inherit that
  license.  This applies to `data/*.jsonl.gz`, the committed browser demo
  lexicon and anything produced by `fleximatcher-wiktionary`.  If you
  redistribute a generated lexicon, keep this attribution and the license
  notice.

The repository-wide summary lives in [`../../NOTICE.md`](../../NOTICE.md).
