# `data/`

Downloaded and generated lexicons live here.  Everything in this directory is
gitignored except this file, because the artifacts are large and the raw input
is reproducible.

| file | what it is |
| --- | --- |
| `raw-wiktextract-data.jsonl.gz` | raw wiktextract dump, ~2.9 GB gzipped, downloaded (not committed) |
| `wiktionary-it.jsonl.gz` | compact Italian lexicon built by `fleximatcher-wiktionary`, ~12 MB gzipped |

Get the raw dump and rebuild the lexicon as described in
[`../tools/wiktextract/README.md`](../tools/wiktextract/README.md).

Generated lexicons are derived from Wiktionary and are licensed CC BY-SA /
GFDL, **not** MIT; see [`../NOTICE.md`](../NOTICE.md).
