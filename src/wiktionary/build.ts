#!/usr/bin/env node

/**
 * Build a compact Wiktionary lexicon from a raw wiktextract JSONL dump.
 *
 * Example:
 *
 * ```sh
 * npm run build
 * node dist/wiktionary/build.js \
 *   --input ../wiktionary-web/raw-wiktextract-data.jsonl.gz \
 *   --output data/wiktionary-it.jsonl.gz \
 *   --language it
 * ```
 */

import { once } from "node:events";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createGunzip, createGzip } from "node:zlib";

import {
  type LexiconEntry,
  transformEntry,
  type WiktextractEntry,
} from "./transform.js";

export interface BuildLexiconOptions {
  input: string;
  output: string;
  /** wiktextract `lang_code` to keep. Defaults to `it`. */
  language?: string;
  languageName?: string;
  /** Stop after this many matching entries (0 = unlimited). */
  limit?: number;
  /** Keep derivational/alternative forms. Defaults to true. */
  includeDerived?: boolean;
  /** Log progress every N scanned lines (0 disables). */
  progressEvery?: number;
  /** Logger; defaults to `console.error`. */
  log?: (message: string) => void;
}

export interface BuildLexiconStats {
  scanned: number;
  matched: number;
  written: number;
  skipped: number;
}

function compact(entry: LexiconEntry): Record<string, unknown> {
  const result: Record<string, unknown> = {
    w: entry.word,
    l: entry.lemma,
    p: entry.pos,
    f: entry.features,
  };
  if (entry.declension !== undefined) {
    result.d = entry.declension;
  }
  return result;
}

/** Stream `input` and write the compact lexicon to `output`. */
export async function buildLexicon(
  options: BuildLexiconOptions,
): Promise<BuildLexiconStats> {
  const {
    input,
    output,
    language = "it",
    languageName,
    limit = 0,
    includeDerived = true,
    progressEvery = 100_000,
    log = (message) => console.error(message),
  } = options;

  const inputGzip = input.endsWith(".gz");
  const outputGzip = output.endsWith(".gz");
  const fileStream = createReadStream(input);
  const source = inputGzip ? fileStream.pipe(createGunzip()) : fileStream;
  const lines = createInterface({ input: source, crlfDelay: Infinity });

  const outputDir = dirname(output);
  if (outputDir && outputDir !== ".") {
    mkdirSync(outputDir, { recursive: true });
  }
  const fileOut = createWriteStream(output);
  const sink = outputGzip ? createGzip() : fileOut;
  if (outputGzip) {
    sink.pipe(fileOut);
  }

  const write = async (line: string): Promise<void> => {
    if (!sink.write(line)) {
      await once(sink, "drain");
    }
  };

  await write(
    `${JSON.stringify({
      format: "fleximatcher-wiktionary-lexicon",
      version: 1,
      language,
      languageName,
      generatedAt: new Date().toISOString(),
    })}\n`,
  );

  let scanned = 0;
  let matched = 0;
  let written = 0;
  let skipped = 0;

  try {
    for await (const line of lines) {
      scanned += 1;
      if (progressEvery > 0 && scanned % progressEvery === 0) {
        log(
          `scanned ${scanned.toLocaleString()} lines, matched ${matched.toLocaleString()}, written ${written.toLocaleString()}`,
        );
      }
      if (!line.trim()) {
        continue;
      }

      let raw: WiktextractEntry;
      try {
        raw = JSON.parse(line) as WiktextractEntry;
      } catch {
        skipped += 1;
        continue;
      }

      if (raw.lang_code !== language) {
        continue;
      }

      matched += 1;
      const entries = transformEntry(raw);
      for (const entry of entries) {
        if (!includeDerived && entry.features.includes("derived")) {
          skipped += 1;
          continue;
        }
        await write(`${JSON.stringify(compact(entry))}\n`);
        written += 1;
      }

      if (limit > 0 && matched >= limit) {
        break;
      }
    }
  } catch (error) {
    sink.destroy();
    fileOut.destroy();
    throw error;
  } finally {
    lines.close();
    source.destroy();
    fileStream.destroy();
  }

  if (outputGzip) {
    sink.end();
    await once(fileOut, "finish");
  } else {
    sink.end();
    await once(fileOut, "finish");
  }

  return { scanned, matched, written, skipped };
}

/** CLI entry point. */
function parseCliArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      input: { type: "string" },
      output: { type: "string" },
      language: { type: "string", default: "it" },
      "language-name": { type: "string" },
      limit: { type: "string", default: "0" },
      "no-derived": { type: "boolean", default: false },
      progress: { type: "string", default: "100000" },
      help: { type: "boolean", default: false },
    },
  });
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const { values } = parsed;
  if (values.help || !values.input || !values.output) {
    console.error(
      [
        "Usage: fleximatcher-wiktionary --input RAW.jsonl[.gz] --output LEXICON.jsonl[.gz]",
        "",
        "Options:",
        "  --language CODE       wiktextract lang_code to keep (default: it)",
        "  --language-name NAME  human-readable language name",
        "  --limit N             stop after N matching entries (0 = all)",
        "  --no-derived          skip entries marked as derived/alternative",
        "  --progress N          progress log interval in scanned lines",
      ].join("\n"),
    );
    return values.help ? 0 : 2;
  }

  const limit = Number.parseInt(values.limit, 10);
  const progressEvery = Number.parseInt(values.progress, 10);
  if (
    !Number.isFinite(limit) ||
    limit < 0 ||
    !Number.isFinite(progressEvery) ||
    progressEvery < 0
  ) {
    console.error("--limit and --progress must be non-negative integers");
    return 2;
  }

  try {
    const stats = await buildLexicon({
      input: values.input,
      output: values.output,
      language: values.language,
      languageName: values["language-name"],
      limit,
      includeDerived: !values["no-derived"],
      progressEvery,
    });
    console.error(
      `done: scanned ${stats.scanned.toLocaleString()}, matched ${stats.matched.toLocaleString()}, wrote ${stats.written.toLocaleString()} entries, skipped ${stats.skipped.toLocaleString()}`,
    );
    return 0;
  } catch (error) {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    return 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  void main().then((code) => process.exit(code));
}
