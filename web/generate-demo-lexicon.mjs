#!/usr/bin/env node
/**
 * Extract a small, curated Italian lexicon for the browser demo.
 *
 * Usage:
 *   node web/generate-demo-lexicon.mjs \
 *     data/wiktionary-it.jsonl.gz \
 *     web/frontend/src/demo-lexicon.json
 */

import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

import { normalizeWordKey } from "../dist/wiktionary/index.js";

const [, , input = "data/wiktionary-it.jsonl.gz", output = "web/frontend/src/demo-lexicon.json"] =
  process.argv;

const LEMMAS = `
casa uomo donna mela acqua cane gatto libro città amico amica padre madre
fratello sorella bambino bambina sole luna mare montagna strada scuola lavoro
tempo giorno notte anno mese mondo vita amore cibo pane vino latte caffè pesce
carne verdura frutta fiore albero animale porta finestra tavolo sedia automobile
treno aereo musica storia lingua parola frase numero

grande piccolo bello buono cattivo nuovo vecchio giovane libero felice triste
rosso blu verde lungo corto alto basso facile difficile importante italiano

essere avere andare dare fare dire vedere venire parlare mangiare bere sapere
potere volere dovere amare vivere lavorare studiare leggere scrivere capire
prendere mettere uscire entrare tornare stare rimanere sentire guardare
ascoltare pensare credere trovare cercare comprare vendere aprire chiudere

il lo la i gli le l' un uno una un' di del dello della dei degli delle dell'
a al allo alla ai agli alle all' da dal dalla in nel nella con col su sul sulla
per tra fra e ed ma o od che se perché quando come non più meno molto poco
sempre mai già ancora qui qua lì là bene male così anche solo ora oggi domani
ieri io tu lui lei noi voi loro mi ti ci vi ne questo questa questi queste
quello quella quelli quelle
`;

const words = new Set(LEMMAS.trim().split(/\s+/).filter(Boolean).map(normalizeWordKey));

const ALLOWED_POS = new Set([
  "noun",
  "name",
  "adj",
  "verb",
  "adv",
  "pron",
  "det",
  "article",
  "prep",
  "conj",
  "intj",
  "num",
  "particle",
  "contraction",
]);

const entries = new Map();
const file = createReadStream(input);
const source = input.endsWith(".gz") ? file.pipe(createGunzip()) : file;
const lines = createInterface({ input: source, crlfDelay: Infinity });

let scanned = 0;
let kept = 0;
for await (const line of lines) {
  scanned += 1;
  if (!line.trim()) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry.format !== undefined) continue;
  const word = entry.w;
  const lemma = entry.l;
  const pos = entry.p;
  if (typeof word !== "string" || typeof lemma !== "string" || typeof pos !== "string") {
    continue;
  }
  if (!ALLOWED_POS.has(pos)) continue;
  if (!words.has(normalizeWordKey(word)) && !words.has(normalizeWordKey(lemma))) {
    continue;
  }
  const key = normalizeWordKey(word);
  let bucket = entries.get(key);
  if (bucket === undefined) {
    bucket = [];
    entries.set(key, bucket);
  }
  const dedup = `${pos}\u0000${lemma}\u0000${(entry.f ?? []).join("\u0001")}`;
  if (bucket.some((candidate) => candidate.__dedup === dedup)) {
    continue;
  }
  bucket.push({ ...entry, __dedup: dedup });
  kept += 1;
}

const data = {
  format: "fleximatcher-wiktionary-lexicon",
  version: 1,
  language: "it",
  languageName: "Italian (browser demo)",
  demo: true,
  generatedFrom: "wiktextract",
  words: Object.fromEntries(
    [...entries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, bucket]) => [
        key,
        bucket
          .map(({ __dedup, ...entry }) => entry)
          .sort((left, right) => left.p.localeCompare(right.p) || left.l.localeCompare(right.l)),
      ]),
  ),
};

const out = createWriteStream(output);
out.end(JSON.stringify(data));
await once(out, "finish");
console.error(`scanned ${scanned.toLocaleString()} lines, kept ${kept.toLocaleString()} entries for ${entries.size.toLocaleString()} words`);
