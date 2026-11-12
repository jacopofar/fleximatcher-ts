#!/usr/bin/env node

/**
 * Fleximatcher playground server.
 *
 * Serves the built Vite app (web/frontend/dist) and a JSON API backed by the
 * full Italian Wiktionary lexicon.
 *
 *   npm run build
 *   node web/server.mjs
 *
 * Environment:
 *   PORT=8787
 *   WIKTIONARY_LEXICON=data/wiktionary-it.jsonl.gz
 */

import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AnnotationStore,
  FlexiMatcher,
  splitPattern,
} from "../dist/browser.js";
import {
  loadWiktionaryLexicon,
  registerWiktionaryRules,
} from "../dist/wiktionary/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");
const staticDir = resolve(here, "frontend", "dist");
const lexiconPath =
  process.env.WIKTIONARY_LEXICON ??
  resolve(repoRoot, "data/wiktionary-it.jsonl.gz");
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const VERSION = "0.1.0";

const ANNOTATORS = [
  { name: "it-noun", label: "Noun", group: "Word classes" },
  { name: "it-name", label: "Proper noun", group: "Word classes" },
  { name: "it-adj", label: "Adjective", group: "Word classes" },
  { name: "it-verb", label: "Verb", group: "Word classes" },
  { name: "it-adv", label: "Adverb", group: "Word classes" },
  { name: "it-article", label: "Article", group: "Function words" },
  { name: "it-contraction", label: "Contraction", group: "Function words" },
  { name: "it-prep", label: "Preposition", group: "Function words" },
  { name: "it-conj", label: "Conjunction", group: "Function words" },
  { name: "it-pron", label: "Pronoun", group: "Function words" },
  { name: "it-det", label: "Determiner", group: "Function words" },
  { name: "it-num", label: "Numeral", group: "Function words" },
];

let lexicon = null;
let lexiconError = null;

async function loadLexicon() {
  const started = Date.now();
  try {
    lexicon = await loadWiktionaryLexicon(lexiconPath);
    console.log(
      `Loaded ${lexicon.languageName ?? lexicon.language}: ${lexicon.entryCount.toLocaleString()} entries, ${lexicon.wordCount.toLocaleString()} words in ${Date.now() - started} ms`,
    );
  } catch (error) {
    lexicon = null;
    lexiconError = error instanceof Error ? error.message : String(error);
    console.error(`Could not load lexicon at ${lexiconPath}: ${lexiconError}`);
  }
}

function normalizeChunk(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("[") ? trimmed : `[${trimmed}]`;
}

function serializeAnnotation(annotation, text) {
  return {
    start: annotation.start,
    end: annotation.end,
    type: annotation.type,
    data: annotation.data ?? null,
    covered: text.slice(annotation.start, annotation.end),
  };
}

function literalPatternChunks(pattern) {
  if (!pattern.trim()) {
    return new Set();
  }
  try {
    return new Set(
      splitPattern(pattern).filter((chunk) => !chunk.startsWith("[")),
    );
  } catch {
    return new Set();
  }
}

function matcherFor(tags, explain) {
  const matcher = new FlexiMatcher({ explain });
  if (lexicon !== null) {
    registerWiktionaryRules(matcher, lexicon, { prefix: lexicon.language });
  }
  for (const tag of tags) {
    matcher.addTagRule(tag.tag, tag.pattern, {
      identifier: tag.identifier,
      template: tag.template ?? null,
    });
  }
  return matcher;
}

function validateTags(tags) {
  if (tags === undefined) return [];
  if (!Array.isArray(tags) || tags.length > 100) {
    throw new Error("tags must be an array of at most 100 definitions");
  }
  return tags.map((tag, index) => {
    if (
      tag === null ||
      typeof tag !== "object" ||
      typeof tag.tag !== "string" ||
      typeof tag.pattern !== "string" ||
      typeof tag.identifier !== "string"
    ) {
      throw new Error(
        `tags[${index}] needs tag, pattern and identifier strings`,
      );
    }
    return {
      tag: tag.tag,
      pattern: tag.pattern,
      identifier: tag.identifier,
      template: tag.template,
    };
  });
}

function annotate(body) {
  const text = body?.text;
  if (typeof text !== "string") {
    throw new Error("text must be a string");
  }
  if (text.length > 50_000) {
    throw new Error("text is too long (max 50,000 characters)");
  }
  const annotators = body?.annotators;
  if (!Array.isArray(annotators) || annotators.length > 50) {
    throw new Error("annotators must be an array of at most 50 chunks");
  }
  const pattern = typeof body?.pattern === "string" ? body.pattern : "";
  if (pattern.length > 10_000) {
    throw new Error("pattern is too long");
  }
  const options = body?.options ?? {};
  const tags = validateTags(body?.tags);
  const explain = Boolean(options.explain);
  const started = Date.now();

  const matcher = matcherFor(tags, explain);
  const store = new AnnotationStore({ text, explain });
  const errors = [];

  const annotationRun = matcher.annotate(text, {
    rules: annotators.map(normalizeChunk).filter(Boolean),
    store,
    explain,
    fullyAnnotate: true,
    onError: "collect",
  });
  for (const { rule, error } of annotationRun.errors) {
    errors.push(
      `${rule}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let matching;
  let interpretations = [];
  if (pattern.trim()) {
    try {
      const result = matcher.matches(text, pattern, {
        store,
        matchWhole: Boolean(options.matchWhole),
        fullyAnnotate: true,
        populateResult: true,
      });
      matching = result.matching;
      interpretations = (result.interpretations ?? []).map((sequence) => ({
        annotations: sequence.map((annotation) =>
          serializeAnnotation(annotation, text),
        ),
        covered:
          sequence.length === 0
            ? ""
            : text.slice(sequence[0].start, sequence[sequence.length - 1].end),
      }));
    } catch (error) {
      errors.push(
        `pattern: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const literalTypes = literalPatternChunks(pattern);
  const annotations = store.annotations
    .filter(
      (annotation) =>
        !literalTypes.has(annotation.type) &&
        (annotation.type.startsWith("[") || annotation.data !== undefined),
    )
    .map((annotation) => serializeAnnotation(annotation, text))
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.type.localeCompare(right.type),
    );

  return {
    source: "server",
    annotations,
    interpretations,
    matching,
    elapsedMs: Date.now() - started,
    errors,
    stats: lexicon
      ? {
          language: lexicon.language,
          languageName: lexicon.languageName,
          words: lexicon.wordCount,
          entries: lexicon.entryCount,
        }
      : null,
  };
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(body);
}

async function readBody(request, limit = 2_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) {
      throw new Error("request body is too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

function staticMessage() {
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Fleximatcher playground</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:12vh auto;padding:0 24px;color:#25211c;background:#f6f0e7}code{background:#fffaf2;border:1px solid #ddd2c4;border-radius:6px;padding:2px 6px}pre{background:#fffaf2;border:1px solid #ddd2c4;border-radius:12px;padding:16px;overflow:auto}</style>
<h1>Fleximatcher playground</h1>
<p>The API is running, but the frontend has not been built yet.</p>
<pre>cd web/frontend
npm install
npm run build</pre>
<p>Then reload this page, or run the Vite dev server with <code>npm run dev</code>.</p>
</html>`;
}

async function serveStatic(response, url) {
  if (!existsSync(staticDir)) {
    const body = staticMessage();
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const relative =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = resolve(staticDir, relative);
  if (filePath !== staticDir && !filePath.startsWith(`${staticDir}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = resolve(filePath, "index.html");
    }
    const finalInfo = await stat(filePath);
    if (!finalInfo.isFile()) {
      throw new Error("not a file");
    }
    response.writeHead(200, {
      "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
      "content-length": finalInfo.size,
    });
    createReadStream(filePath).pipe(response);
  } catch {
    if (extname(pathname)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const fallback = resolve(staticDir, "index.html");
    const info = await stat(fallback);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": info.size,
    });
    createReadStream(fallback).pipe(response);
  }
}

async function handle(request, response) {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    response.end();
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      version: VERSION,
      lexicon: lexicon
        ? {
            language: lexicon.language,
            languageName: lexicon.languageName,
            words: lexicon.wordCount,
            entries: lexicon.entryCount,
          }
        : null,
      lexiconError,
    });
    return;
  }

  if (url.pathname === "/api/rules") {
    sendJson(response, 200, { annotators: ANNOTATORS, version: VERSION });
    return;
  }

  if (url.pathname === "/api/annotate" && request.method === "POST") {
    try {
      const body = JSON.parse(await readBody(request));
      sendJson(response, 200, annotate(body));
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Unknown API endpoint" });
    return;
  }

  await serveStatic(response, url);
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "Internal server error" });
    } else {
      response.destroy();
    }
  });
});

await loadLexicon();
server.listen(port, () => {
  console.log(`Fleximatcher playground: http://localhost:${port}`);
  if (!existsSync(staticDir)) {
    console.log(
      "Frontend not built yet; API is available and the page shows build instructions.",
    );
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n${signal}: shutting down`);
    server.close(() => process.exit(0));
  });
}
