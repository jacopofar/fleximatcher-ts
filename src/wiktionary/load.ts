/**
 * Node-only Wiktionary lexicon loading.
 *
 * Browser code should use `WiktionaryLexicon.fromData` / `fromEntries` from
 * the browser entry instead; this module uses `node:fs`, `node:readline` and
 * `node:zlib`.
 */

import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip, gunzipSync } from "node:zlib";

import {
  createWiktionaryEntry,
  WiktionaryLexicon,
  type WiktionaryEntryInput,
  type WiktionaryLexiconData,
  type WiktionaryLexiconLoadOptions,
} from "./lexicon.js";

/**
 * Load a lexicon from `.json`, `.json.gz`, `.jsonl`, `.jsonl.gz`, `.ndjson`
 * or `.ndjson.gz`.
 */
export async function loadWiktionaryLexicon(
  path: string,
  options: WiktionaryLexiconLoadOptions = {},
): Promise<WiktionaryLexicon> {
  const gzipped = path.endsWith(".gz");
  const base = gzipped ? path.slice(0, -3) : path;

  if (base.endsWith(".jsonl") || base.endsWith(".ndjson")) {
    return loadJsonl(path, gzipped, options);
  }
  if (base.endsWith(".json")) {
    const buffer = readFileSync(path);
    const text = gzipped
      ? gunzipSync(buffer).toString("utf8")
      : buffer.toString("utf8");
    return WiktionaryLexicon.fromData(
      JSON.parse(text) as WiktionaryLexiconData,
      options,
    );
  }

  throw new Error(
    `Unsupported lexicon format for ${JSON.stringify(path)}; use .json, .jsonl or .ndjson (optionally .gz)`,
  );
}

async function loadJsonl(
  path: string,
  gzipped: boolean,
  options: WiktionaryLexiconLoadOptions,
): Promise<WiktionaryLexicon> {
  const file = createReadStream(path);
  const source = gzipped ? file.pipe(createGunzip()) : file;
  const lines = createInterface({ input: source, crlfDelay: Infinity });
  const lexicon = WiktionaryLexicon.empty("und", undefined, options.pos);
  let sawHeader = false;

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const raw = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      !sawHeader &&
      typeof raw.format === "string" &&
      raw.w === undefined &&
      raw.word === undefined &&
      raw.words === undefined
    ) {
      sawHeader = true;
      lexicon.setMetadata(
        typeof raw.language === "string" ? raw.language : "und",
        typeof raw.languageName === "string" ? raw.languageName : undefined,
      );
      continue;
    }
    if (raw.words !== undefined && typeof raw.words === "object") {
      const nested = WiktionaryLexicon.fromData(
        raw as unknown as WiktionaryLexiconData,
        options,
      );
      for (const entry of nested.entries()) {
        lexicon.add(entry);
      }
      continue;
    }
    lexicon.add(
      createWiktionaryEntry(raw as unknown as WiktionaryEntryInput),
    );
  }

  lexicon.seal();
  return lexicon;
}
