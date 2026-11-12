import {
  type Annotation,
  AnnotationStore,
  FlexiMatcher,
  ProvenanceGraph,
  splitPattern,
} from "fleximatcher";
import {
  registerWiktionaryRules,
  WiktionaryLexicon,
  type WiktionaryLexiconData,
} from "fleximatcher/wiktionary/browser";

import { demoLexiconData } from "./demo-lexicon";
import "./style.css";

type Mode = "client" | "server";

interface SerializedAnnotation {
  start: number;
  end: number;
  type: string;
  data: unknown;
  covered: string;
}

interface SerializedInterpretation {
  annotations: SerializedAnnotation[];
  covered: string;
}

interface Explanation {
  id: string | null;
  children: ExplanationChild[];
}

interface ExplanationChild {
  start: number;
  end: number;
  type: string;
  explanation: Explanation | null;
}

interface HierarchyNode {
  type: string;
  start: number;
  end: number;
  covered: string;
  data?: unknown;
  annotationIndex?: number;
  explanationId?: string | null;
  children: HierarchyNode[];
}

interface HierarchyResult {
  roots: HierarchyNode[];
  mode: "derivation" | "interpretation" | "none";
}

interface ProvenanceStep {
  type: string;
  id: string | null;
}

type ProvenanceIndex = Map<number, readonly ProvenanceStep[]>;

interface RunResult {
  source: Mode;
  annotations: SerializedAnnotation[];
  interpretations: SerializedInterpretation[];
  matching?: boolean;
  elapsedMs: number;
  errors: string[];
}

interface TagDefinition {
  tag: string;
  pattern: string;
  identifier: string;
  template?: string;
}

interface AnnotatorDescriptor {
  expression: string;
  label: string;
  group: string;
  description?: string;
}

interface ServerHealth {
  ok: boolean;
  version?: string;
  lexicon?: {
    language: string;
    languageName?: string;
    words: number;
    entries: number;
  } | null;
}

interface AppState {
  mode: Mode;
  text: string;
  selected: Set<string>;
  pattern: string;
  matchWhole: boolean;
  explain: boolean;
  tags: string;
  serverAvailable: boolean;
  serverHealth: ServerHealth | null;
  lastResult: RunResult | null;
  provenanceGraph: ProvenanceGraph | null;
  running: boolean;
  error: string;
}

const SAMPLE_TEXT = "Le case sono belle, ma l'uomo dell'acqua non lo sa.";
const SAMPLE_PATTERN =
  "Le [it-noun:feminine plural] sono [it-adj:feminine plural]";

const DEMO_GRAMMAR = [
  'determiner\t[it-article]\tid_det\t{"word":"${0}"}',
  'determiner\t[it-contraction]\tid_det_contr\t{"word":"${0}"}',
  'nominal\t[it-noun]\tid_nom\t{"lemma":"${0.lemma}"}',
  'noun-phrase\t[tag:determiner] [tag:nominal]\tid_np\t{"determiner":"${0.word}","noun":"${2.lemma}"}',
  'noun-phrase\t[tag:determiner][tag:nominal]\tid_np_elision\t{"determiner":"${0.word}","noun":"${1.lemma}"}',
  'noun-phrase\t[tag:nominal]\tid_np_nom\t{"noun":"${0.lemma}"}',
].join("\n");

const ANNOTATORS: AnnotatorDescriptor[] = [
  { expression: "[it-noun]", label: "Noun", group: "Word classes" },
  { expression: "[it-name]", label: "Proper noun", group: "Word classes" },
  { expression: "[it-adj]", label: "Adjective", group: "Word classes" },
  { expression: "[it-verb]", label: "Verb", group: "Word classes" },
  { expression: "[it-adv]", label: "Adverb", group: "Word classes" },
  { expression: "[it-article]", label: "Article", group: "Function words" },
  {
    expression: "[it-contraction]",
    label: "Contraction",
    group: "Function words",
  },
  { expression: "[it-prep]", label: "Preposition", group: "Function words" },
  { expression: "[it-conj]", label: "Conjunction", group: "Function words" },
  { expression: "[it-pron]", label: "Pronoun", group: "Function words" },
  { expression: "[it-det]", label: "Determiner", group: "Function words" },
  { expression: "[it-num]", label: "Numeral", group: "Function words" },
  { expression: "[r:[\\p{L}]+]", label: "Any word", group: "Built-in" },
  { expression: "[r:\\d+(?:[.,]\\d+)?]", label: "Number", group: "Built-in" },
];

const DEFAULT_SELECTED = new Set([
  "[it-noun]",
  "[it-adj]",
  "[it-verb]",
  "[it-article]",
  "[it-contraction]",
]);

const state: AppState = {
  mode: "client",
  text: SAMPLE_TEXT,
  selected: new Set(DEFAULT_SELECTED),
  pattern: SAMPLE_PATTERN,
  matchWhole: false,
  explain: false,
  tags: "",
  serverAvailable: false,
  serverHealth: null,
  lastResult: null,
  provenanceGraph: null,
  running: false,
  error: "",
};

let clientLexicon = WiktionaryLexicon.fromData(demoLexiconData);
let clientLexiconLabel = "browser demo";

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) {
  throw new Error("Missing #app");
}

app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <div class="brand__mark">⌘</div>
      <div>
        <h1>Fleximatcher</h1>
        <p>annotation playground</p>
      </div>
    </div>
    <div class="topbar__right">
      <div class="mode-switch" role="group" aria-label="Runtime">
        <button id="mode-client" class="mode-button is-active" type="button">Client demo</button>
        <button id="mode-server" class="mode-button" type="button">Wiktionary server</button>
      </div>
      <div id="status-pill" class="status-pill">loading…</div>
    </div>
  </header>

  <main class="layout">
    <aside class="panel controls">
      <section class="section">
        <div class="section__head">
          <h2>Text</h2>
          <div class="row row--tight">
            <button id="sample-button" class="ghost-button" type="button">Sample</button>
            <button id="clear-button" class="ghost-button" type="button">Clear</button>
          </div>
        </div>
        <textarea id="text-input" class="text-input" rows="7" spellcheck="false"></textarea>
      </section>

      <section class="section">
        <div class="section__head">
          <h2>Annotators</h2>
          <span class="hint">click to toggle</span>
        </div>
        <div id="annotator-chips" class="chip-groups"></div>
        <div class="row row--tight row--input">
          <input id="custom-annotator" class="text-input text-input--single" type="text" placeholder="custom chunk, e.g. [it-noun:feminine plural]" />
          <button id="add-annotator" class="small-button" type="button">Add</button>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <h2>Pattern</h2>
          <button id="sample-pattern" class="ghost-button" type="button">Sample</button>
        </div>
        <textarea id="pattern-input" class="text-input text-input--single pattern-input" rows="2" spellcheck="false"></textarea>
        <div class="row row--tight options">
          <label class="check"><input id="match-whole" type="checkbox" /> whole text</label>
          <label class="check"><input id="explain" type="checkbox" /> explain tags</label>
        </div>
      </section>

      <section class="section">
        <details class="details">
          <summary>Tag rules (TSV) <span class="hint">optional</span></summary>
          <textarea id="tags-input" class="text-input tags-input" rows="6" spellcheck="false" placeholder="# tag&#9;pattern&#9;identifier&#9;template&#10;fruit&#9;pear&#9;id_pear&#9;{&quot;name&quot;:&quot;pear&quot;}"></textarea>
          <div class="row row--tight">
            <input id="tags-file" class="file-input" type="file" accept=".tsv,.txt" />
            <span class="hint">or paste TSV above</span>
          </div>
        </details>
        <details class="details">
          <summary>Lexicon <span class="hint">client mode</span></summary>
          <p class="hint" id="lexicon-hint"></p>
          <input id="lexicon-file" class="file-input" type="file" accept=".json,application/json" />
        </details>
      </section>

      <div class="run-row">
        <button id="run-button" class="run-button" type="button">Annotate</button>
        <span id="run-hint" class="hint">Ctrl/⌘ + Enter</span>
      </div>
      <p id="server-info" class="hint server-info"></p>
    </aside>

    <section class="output">
      <div class="result-head">
        <div>
          <h2>Annotated text</h2>
          <p id="stats" class="hint">No run yet.</p>
        </div>
        <div class="row row--tight">
          <button id="export-run" class="ghost-button" type="button">Export JSON</button>
          <button id="export-svg" class="ghost-button" type="button">SVG</button>
          <button id="export-png" class="ghost-button" type="button">PNG</button>
          <button id="refresh-server" class="ghost-button" type="button">Check server</button>
        </div>
      </div>

      <article class="paper">
        <div id="annotated-text" class="annotated-text"></div>
      </article>

      <section id="hierarchy-section" class="result-section hierarchy-section">
        <div class="section__head">
          <h2>Derivation hierarchy</h2>
          <div class="row row--tight">
            <span id="hierarchy-note" class="hint"></span>
            <button id="demo-grammar" class="ghost-button" type="button">Try tag grammar</button>
          </div>
        </div>
        <div id="hierarchy" class="hierarchy"></div>
      </section>

      <div id="errors" class="errors" hidden></div>

      <div class="columns">
        <section class="result-section">
          <div class="section__head">
            <h2>Annotations <span id="ann-count" class="count">0</span></h2>
          </div>
          <div id="annotation-list" class="annotation-list"></div>
        </section>

        <section id="interpretations-section" class="result-section">
          <div class="section__head">
            <h2>Interpretations <span id="interp-count" class="count">0</span></h2>
          </div>
          <div id="interpretations" class="interpretations"></div>
        </section>
      </div>
    </section>
  </main>
`;

function $<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing element ${selector}`);
  }
  return element;
}

const textInput = $<HTMLTextAreaElement>("#text-input");
const patternInput = $<HTMLTextAreaElement>("#pattern-input");
const matchWholeInput = $<HTMLInputElement>("#match-whole");
const explainInput = $<HTMLInputElement>("#explain");
const tagsInput = $<HTMLTextAreaElement>("#tags-input");
const annotatorChips = $<HTMLDivElement>("#annotator-chips");
const customAnnotator = $<HTMLInputElement>("#custom-annotator");
const runButton = $<HTMLButtonElement>("#run-button");
const statusPill = $<HTMLDivElement>("#status-pill");
const serverInfo = $<HTMLParagraphElement>("#server-info");
const stats = $<HTMLParagraphElement>("#stats");
const errorsBox = $<HTMLDivElement>("#errors");
const annotatedText = $<HTMLDivElement>("#annotated-text");
const hierarchy = $<HTMLDivElement>("#hierarchy");
const hierarchyNote = $<HTMLSpanElement>("#hierarchy-note");
const annotationList = $<HTMLDivElement>("#annotation-list");
const annCount = $<HTMLSpanElement>("#ann-count");
const interpretationsSection = $<HTMLElement>("#interpretations-section");
const interpretations = $<HTMLDivElement>("#interpretations");
const interpCount = $<HTMLSpanElement>("#interp-count");
const lexiconHint = $<HTMLParagraphElement>("#lexicon-hint");

textInput.value = state.text;
patternInput.value = state.pattern;
matchWholeInput.checked = state.matchWhole;
explainInput.checked = state.explain;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function normalizeAnnotator(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("[") ? trimmed : `[${trimmed}]`;
}

function parseTags(source: string): TagDefinition[] {
  const tags: TagDefinition[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) {
      return;
    }
    const columns = line.split("\t");
    let tag: string;
    let pattern: string;
    let identifier: string;
    let template: string | undefined;
    if (columns.length === 2) {
      [tag, pattern] = columns;
      identifier = `web_${index + 1}`;
    } else if (columns.length === 3) {
      [tag, pattern, template] = columns;
      identifier = `web_${index + 1}`;
    } else if (columns.length === 4) {
      [tag, pattern, identifier, template] = columns;
    } else {
      throw new Error(
        `Tag line ${index + 1} has ${columns.length} columns; expected 2, 3 or 4`,
      );
    }
    tags.push({
      tag,
      pattern,
      identifier,
      template: template?.trim() ? template : undefined,
    });
  });
  return tags;
}

function serializeAnnotation(
  annotation: Annotation,
  text: string,
): SerializedAnnotation {
  return {
    start: annotation.start,
    end: annotation.end,
    type: annotation.type,
    data: annotation.data ?? null,
    covered: text.slice(annotation.start, annotation.end),
  };
}

function literalPatternChunks(pattern: string): Set<string> {
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

/**
 * Derivation hierarchy support.
 *
 * Tag annotations produced with `explain: true` carry data.__explain with
 * `{ id, children }`.  Children identify spans/types and may carry their own
 * __explain for nested tags.  We turn that into a forest of HierarchyNode
 * objects; root detection skips annotations that are already children of
 * another explanation.  Without explanations we fall back to pattern
 * composition: a synthetic `match` root over each interpretation.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toExplanation(value: unknown): Explanation | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const rawChildren = Array.isArray(record.children) ? record.children : [];
  return {
    id: typeof record.id === "string" ? record.id : null,
    children: rawChildren
      .map((child) => toExplanationChild(child))
      .filter((child): child is ExplanationChild => child !== null),
  };
}

function toExplanationChild(value: unknown): ExplanationChild | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const { start, end, type } = record;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    typeof type !== "string"
  ) {
    return null;
  }
  return {
    start,
    end,
    type,
    explanation: toExplanation(record.__explain),
  };
}

function explanationOfData(data: unknown): Explanation | null {
  const record = asRecord(data);
  return record === null ? null : toExplanation(record.__explain);
}

function hierarchyKey(value: {
  start: number;
  end: number;
  type: string;
}): string {
  return `${value.start}:${value.end}:${value.type}`;
}

function collectChildKeys(
  explanation: Explanation,
  target: Set<string>,
  seen: Set<string> = new Set(),
): void {
  for (const child of explanation.children) {
    const key = hierarchyKey(child);
    target.add(key);
    if (child.explanation !== null && !seen.has(key)) {
      seen.add(key);
      collectChildKeys(child.explanation, target, seen);
    }
  }
}

function leafNode(
  value: { start: number; end: number; type: string },
  text: string,
): HierarchyNode {
  return {
    type: value.type,
    start: value.start,
    end: value.end,
    covered: text.slice(value.start, value.end),
    children: [],
  };
}

type AnnotationLookup = Map<
  string,
  { annotation: SerializedAnnotation; index: number }
>;

function buildChildNode(
  child: ExplanationChild,
  annotations: AnnotationLookup,
  text: string,
  path: Set<string>,
): HierarchyNode | null {
  const key = hierarchyKey(child);
  const found = annotations.get(key);
  const explanation =
    child.explanation ??
    (found === undefined ? null : explanationOfData(found.annotation.data));
  if (!child.type.startsWith("[") && explanation === null) {
    return null;
  }
  const cycle = path.has(key);
  const nextPath = new Set(path);
  nextPath.add(key);
  const children =
    explanation === null || cycle
      ? []
      : explanation.children
          .map((nested) => buildChildNode(nested, annotations, text, nextPath))
          .filter((node): node is HierarchyNode => node !== null);
  return {
    type: child.type,
    start: child.start,
    end: child.end,
    covered: text.slice(child.start, child.end),
    data: found?.annotation.data,
    annotationIndex: found?.index,
    explanationId: explanation?.id ?? null,
    children,
  };
}

function buildAnnotationNode(
  annotation: SerializedAnnotation,
  index: number,
  annotations: AnnotationLookup,
  text: string,
  path: Set<string>,
): HierarchyNode {
  const key = hierarchyKey(annotation);
  const explanation = explanationOfData(annotation.data);
  const nextPath = new Set(path);
  nextPath.add(key);
  const children =
    explanation === null
      ? []
      : explanation.children
          .map((child) => buildChildNode(child, annotations, text, nextPath))
          .filter((node): node is HierarchyNode => node !== null);
  return {
    type: annotation.type,
    start: annotation.start,
    end: annotation.end,
    covered: annotation.covered,
    data: annotation.data,
    annotationIndex: index,
    explanationId: explanation?.id ?? null,
    children,
  };
}

function buildHierarchy(result: RunResult, text: string): HierarchyResult {
  const annotations: AnnotationLookup = new Map();
  result.annotations.forEach((annotation, index) => {
    const key = hierarchyKey(annotation);
    if (!annotations.has(key)) {
      annotations.set(key, { annotation, index });
    }
  });

  const childKeys = new Set<string>();
  for (const annotation of result.annotations) {
    const explanation = explanationOfData(annotation.data);
    if (explanation !== null) {
      collectChildKeys(explanation, childKeys);
    }
  }

  const roots: HierarchyNode[] = [];
  result.annotations.forEach((annotation, index) => {
    const explanation = explanationOfData(annotation.data);
    if (explanation === null || childKeys.has(hierarchyKey(annotation))) {
      return;
    }
    roots.push(
      buildAnnotationNode(annotation, index, annotations, text, new Set()),
    );
  });
  if (roots.length > 0) {
    return { roots, mode: "derivation" };
  }

  if (result.interpretations.length > 0) {
    const interpretationRoots: HierarchyNode[] = [];
    for (const interpretation of result.interpretations) {
      if (interpretation.annotations.length === 0) {
        continue;
      }
      const children = interpretation.annotations
        .map((annotation) => {
          const found = annotations.get(hierarchyKey(annotation));
          return found === undefined
            ? leafNode(annotation, text)
            : buildAnnotationNode(
                found.annotation,
                found.index,
                annotations,
                text,
                new Set(),
              );
        })
        .filter(
          (node) => node.type.startsWith("[") || node.children.length > 0,
        );
      const start = interpretation.annotations[0].start;
      const end =
        interpretation.annotations[interpretation.annotations.length - 1].end;
      interpretationRoots.push({
        type: "match",
        start,
        end,
        covered: interpretation.covered || text.slice(start, end),
        children,
      });
    }
    if (interpretationRoots.length > 0) {
      return { roots: interpretationRoots, mode: "interpretation" };
    }
  }

  return { roots: [], mode: "none" };
}

function buildProvenanceIndex(roots: HierarchyNode[]): ProvenanceIndex {
  const index: ProvenanceIndex = new Map();
  const walk = (node: HierarchyNode, path: readonly ProvenanceStep[]): void => {
    const next: ProvenanceStep[] = [
      ...path,
      { type: node.type, id: node.explanationId ?? null },
    ];
    if (
      node.annotationIndex !== undefined &&
      !index.has(node.annotationIndex)
    ) {
      index.set(node.annotationIndex, next);
    }
    for (const child of node.children) {
      walk(child, next);
    }
  };
  for (const root of roots) {
    walk(root, []);
  }
  return index;
}

function buildClientMatcher(tags: TagDefinition[]): FlexiMatcher {
  const matcher = new FlexiMatcher({ explain: state.explain });
  registerWiktionaryRules(matcher, clientLexicon, {
    prefix: clientLexicon.language,
  });
  for (const tag of tags) {
    matcher.addTagRule(tag.tag, tag.pattern, {
      identifier: tag.identifier,
      template: tag.template,
    });
  }
  return matcher;
}

function runClient(): RunResult {
  const started = performance.now();
  const tags = parseTags(state.tags);
  const matcher = buildClientMatcher(tags);
  const store = new AnnotationStore({
    text: state.text,
    explain: state.explain,
  });
  const errors: string[] = [];
  const literalTypes = literalPatternChunks(state.pattern);

  const annotationRun = matcher.annotate(state.text, {
    rules: [...state.selected].map(normalizeAnnotator).filter(Boolean),
    store,
    explain: state.explain,
    fullyAnnotate: true,
    onError: "collect",
  });
  for (const { rule, error } of annotationRun.errors) {
    errors.push(
      `${rule}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let matching: boolean | undefined;
  let interpretationViews: SerializedInterpretation[] = [];
  if (state.pattern.trim()) {
    try {
      const result = matcher.matches(state.text, state.pattern, {
        store,
        matchWhole: state.matchWhole,
        fullyAnnotate: true,
        populateResult: true,
      });
      matching = result.matching;
      interpretationViews = (result.interpretations ?? []).map((sequence) => ({
        annotations: sequence.map((annotation) =>
          serializeAnnotation(annotation, state.text),
        ),
        covered:
          sequence.length === 0
            ? ""
            : state.text.slice(
                sequence[0].start,
                sequence[sequence.length - 1].end,
              ),
      }));
    } catch (error) {
      errors.push(
        `pattern: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const annotations = store.annotations
    .filter(
      (annotation) =>
        !literalTypes.has(annotation.type) &&
        (annotation.type.startsWith("[") || annotation.data !== undefined),
    )
    .map((annotation) => serializeAnnotation(annotation, state.text))
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.type.localeCompare(right.type),
    );

  return {
    source: "client",
    annotations,
    interpretations: interpretationViews,
    matching,
    elapsedMs: performance.now() - started,
    errors,
  };
}

async function runServer(): Promise<RunResult> {
  const started = performance.now();
  const response = await fetch("/api/annotate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: state.text,
      annotators: [...state.selected].map(normalizeAnnotator).filter(Boolean),
      pattern: state.pattern,
      tags: parseTags(state.tags),
      options: {
        matchWhole: state.matchWhole,
        explain: state.explain,
      },
    }),
  });
  const payload = (await response.json()) as RunResult & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Server error ${response.status}`);
  }
  return {
    ...payload,
    source: "server",
    elapsedMs: performance.now() - started,
    errors: payload.errors ?? [],
  };
}

async function run(): Promise<void> {
  if (state.running) {
    return;
  }
  if (state.selected.size === 0 && !state.pattern.trim()) {
    state.error = "Choose at least one annotator or write a pattern.";
    renderErrors();
    return;
  }
  if (state.mode === "server" && !state.serverAvailable) {
    await refreshServerStatus();
    if (!state.serverAvailable) {
      state.error =
        "The Wiktionary server is not reachable. Start `node web/server.mjs`.";
      renderErrors();
      return;
    }
  }

  state.running = true;
  state.error = "";
  state.lastResult = null;
  renderErrors();
  runButton.disabled = true;
  runButton.textContent = "Annotating…";

  try {
    const result = state.mode === "client" ? runClient() : await runServer();
    state.lastResult = result;
    renderResult(result);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    renderErrors();
  } finally {
    state.running = false;
    runButton.disabled = false;
    runButton.textContent = "Annotate";
  }
}

function colorKeyFor(type: string, data: unknown): string {
  if (data !== null && typeof data === "object" && "pos" in data) {
    return `pos:${String((data as Record<string, unknown>).pos)}`;
  }
  return type;
}

function colorKey(annotation: SerializedAnnotation): string {
  return colorKeyFor(annotation.type, annotation.data);
}

function hierarchyColor(node: HierarchyNode, alpha: number): string {
  return `hsl(${hashHue(colorKeyFor(node.type, node.data))} 72% 52% / ${alpha})`;
}

function hierarchySolid(node: HierarchyNode): string {
  return `hsl(${hashHue(colorKeyFor(node.type, node.data))} 65% 44%)`;
}

function hashHue(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % 360;
}

function colorFor(annotation: SerializedAnnotation, alpha: number): string {
  return `hsl(${hashHue(colorKey(annotation))} 72% 52% / ${alpha})`;
}

function solidColor(annotation: SerializedAnnotation): string {
  return `hsl(${hashHue(colorKey(annotation))} 65% 44%)`;
}

function segmentBackground(annotations: SerializedAnnotation[]): string {
  const colors = annotations
    .slice(0, 3)
    .map((annotation) => colorFor(annotation, 0.32));
  if (colors.length === 1) {
    return colors[0];
  }
  if (colors.length === 2) {
    return `linear-gradient(90deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
  }
  return `linear-gradient(90deg, ${colors[0]} 0 33.3%, ${colors[1]} 33.3% 66.6%, ${colors[2]} 66.6% 100%)`;
}

function renderAnnotatedText(
  text: string,
  annotations: SerializedAnnotation[],
): void {
  annotatedText.replaceChildren();
  if (text.length === 0) {
    annotatedText.append(
      el("span", "empty-state", "Write some text to annotate."),
    );
    return;
  }
  if (annotations.length === 0) {
    annotatedText.append(document.createTextNode(text));
    return;
  }

  const boundaries = new Set<number>([0, text.length]);
  for (const annotation of annotations) {
    boundaries.add(Math.max(0, Math.min(text.length, annotation.start)));
    boundaries.add(Math.max(0, Math.min(text.length, annotation.end)));
  }
  const sorted = [...boundaries].sort((left, right) => left - right);

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    if (end <= start) continue;
    const active = annotations
      .map((annotation, annotationIndex) => ({ annotation, annotationIndex }))
      .filter(
        ({ annotation }) => annotation.start < end && annotation.end > start,
      );

    if (active.length === 0) {
      annotatedText.append(document.createTextNode(text.slice(start, end)));
      continue;
    }

    const span = el("span", "seg", text.slice(start, end));
    span.style.background = segmentBackground(
      active.map((item) => item.annotation),
    );
    span.style.boxShadow = `inset 0 -2px 0 ${solidColor(active[0].annotation)}`;
    span.dataset.annIds = active.map((item) => item.annotationIndex).join(",");
    span.title = active.map((item) => item.annotation.type).join(" | ");
    if (active.length > 1) {
      span.classList.add("seg--stacked");
    }
    span.addEventListener("click", () => {
      setActiveAnnotation(active[0].annotationIndex);
    });
    annotatedText.append(span);
  }
}

function addMeta(parent: HTMLElement, label: string, value: unknown): void {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const chip = el("span", "meta-chip");
  chip.append(el("span", "meta-chip__label", label));
  chip.append(el("span", "meta-chip__value", String(value)));
  parent.append(chip);
}

function renderAnnotations(
  result: RunResult,
  provenance: ProvenanceIndex = new Map(),
  graph: ProvenanceGraph | null = null,
): void {
  annotationList.replaceChildren();
  annCount.textContent = String(result.annotations.length);
  if (result.annotations.length === 0) {
    annotationList.append(
      el(
        "p",
        "empty-state",
        "No annotations yet. Try another annotator or text.",
      ),
    );
    return;
  }

  result.annotations.forEach((annotation, index) => {
    const card = el("article", "ann-card");
    card.dataset.annIndex = String(index);

    const head = el("div", "ann-card__head");
    const dot = el("span", "dot");
    dot.style.background = solidColor(annotation);
    head.append(dot);
    head.append(el("code", "ann-type", annotation.type));
    head.append(el("span", "ann-covered", annotation.covered));
    head.append(
      el("span", "ann-span", `${annotation.start}–${annotation.end}`),
    );
    card.append(head);

    const meta = el("div", "ann-meta");
    const data = annotation.data;
    if (data !== null && typeof data === "object") {
      const record = data as Record<string, unknown>;
      addMeta(meta, "lemma", record.lemma);
      addMeta(meta, "pos", record.pos);
      addMeta(meta, "gender", record.gender);
      addMeta(meta, "number", record.number);
      addMeta(meta, "case", record.case);
      addMeta(meta, "person", record.person);
      addMeta(meta, "mood", record.mood);
      addMeta(meta, "tense", record.tense);
      addMeta(meta, "form", record.verbForm);
      addMeta(meta, "declension", record.declension);
    }
    if (meta.childElementCount > 0) {
      card.append(meta);
    }

    if (data !== null && typeof data === "object") {
      const features = (data as Record<string, unknown>).features;
      if (Array.isArray(features) && features.length > 0) {
        const featureRow = el("div", "features");
        const visible = features.slice(0, 14);
        for (const feature of visible) {
          featureRow.append(el("span", "feature", String(feature)));
        }
        if (features.length > visible.length) {
          featureRow.append(
            el(
              "span",
              "feature feature--more",
              `+${features.length - visible.length}`,
            ),
          );
        }
        card.append(featureRow);
      }
    }

    const path = provenance.get(index);
    if (path !== undefined && path.length > 0) {
      const row = el("div", "provenance");
      row.append(el("span", "provenance__label", "derivation"));
      path.forEach((step, stepIndex) => {
        if (stepIndex > 0) {
          row.append(el("span", "provenance__sep", "›"));
        }
        const chip = el("span", "provenance__step", step.type);
        if (step.id) {
          chip.title = `via ${step.id}`;
        }
        row.append(chip);
      });
      card.append(row);
    }

    if (graph !== null) {
      const node = graph.nodeFor(annotation);
      if (
        node !== undefined &&
        (node.parents.length > 0 || node.children.length > 0)
      ) {
        const details = el("details", "why");
        details.append(el("summary", undefined, "why?"));
        details.addEventListener("toggle", () => {
          if (!details.open || details.dataset.loaded === "1") {
            return;
          }
          details.dataset.loaded = "1";
          const paths = graph.why(annotation);
          if (paths.length === 0) {
            details.append(el("p", "empty-state", "No derivation path."));
            return;
          }
          for (const whyPath of paths) {
            const whyRow = el("div", "why-path");
            whyPath.forEach((step, stepIndex) => {
              if (stepIndex > 0) {
                whyRow.append(el("span", "provenance__sep", "›"));
              }
              const chip = el("span", "provenance__step", step.type);
              if (step.explanationId) {
                chip.title = `via ${step.explanationId}`;
              }
              whyRow.append(chip);
            });
            details.append(whyRow);
          }
        });
        card.append(details);
      }
    }

    const details = el("details", "json-details");
    details.append(el("summary", undefined, "data"));
    const pre = el("pre", "json");
    pre.textContent = JSON.stringify(annotation.data, null, 2) ?? "null";
    details.append(pre);
    card.append(details);

    card.addEventListener("click", () => setActiveAnnotation(index));
    annotationList.append(card);
  });
}

function renderInterpretations(result: RunResult): void {
  const hasPattern = state.pattern.trim().length > 0;
  interpretationsSection.hidden = !hasPattern;
  interpretations.replaceChildren();
  interpCount.textContent = String(result.interpretations.length);
  if (!hasPattern) {
    return;
  }

  if (result.matching === false) {
    interpretations.append(
      el("p", "empty-state", "The pattern does not match the whole text."),
    );
    return;
  }
  if (result.interpretations.length === 0) {
    interpretations.append(el("p", "empty-state", "No interpretations."));
    return;
  }

  result.interpretations.forEach((interpretation, index) => {
    const card = el("article", "interpretation");
    const head = el("div", "interpretation__head");
    head.append(el("strong", undefined, `Interpretation ${index + 1}`));
    head.append(el("span", "interpretation__covered", interpretation.covered));
    card.append(head);

    const sequence = el("div", "sequence");
    interpretation.annotations.forEach((annotation) => {
      const chip = el("button", "sequence-chip");
      chip.type = "button";
      const literal = !annotation.type.startsWith("[");
      if (literal) {
        chip.classList.add("sequence-chip--literal");
      }
      const dot = el("span", "dot");
      dot.style.background = solidColor(annotation);
      if (!literal) {
        chip.append(dot);
      }
      chip.append(el("code", undefined, annotation.type));
      chip.append(el("span", undefined, annotation.covered));
      const target = result.annotations.findIndex(
        (candidate) =>
          candidate.start === annotation.start &&
          candidate.end === annotation.end &&
          candidate.type === annotation.type,
      );
      if (target >= 0) {
        chip.addEventListener("click", () => setActiveAnnotation(target));
      }
      sequence.append(chip);
    });
    card.append(sequence);

    const details = el("details", "json-details");
    details.append(el("summary", undefined, "sequence data"));
    const pre = el("pre", "json");
    pre.textContent = JSON.stringify(
      interpretation.annotations.map((annotation) => annotation.data),
      null,
      2,
    );
    details.append(pre);
    card.append(details);
    interpretations.append(card);
  });
}

/**
 * Flame/icicle layout.
 *
 * Nodes are flattened depth-first, grouped by depth and greedily packed into
 * non-overlapping lanes.  Each character gets one equal-width cell in the
 * ruler; bars use percentage offsets so they align with those cells and can
 * stretch to the panel width.  Deeper rows are children of the row above.
 */
function renderFlame(roots: HierarchyNode[], text: string): HTMLDivElement {
  const RULER_HEIGHT = 30;
  const ROW_HEIGHT = 30;
  const BAR_HEIGHT = 24;

  interface FlatNode {
    node: HierarchyNode;
    depth: number;
    lane: number;
    row: number;
  }

  const flat: FlatNode[] = [];
  const walk = (nodes: HierarchyNode[], depth: number): void => {
    for (const node of nodes) {
      flat.push({ node, depth, lane: 0, row: 0 });
      walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);

  const byDepth = new Map<number, FlatNode[]>();
  for (const item of flat) {
    const bucket = byDepth.get(item.depth) ?? [];
    bucket.push(item);
    byDepth.set(item.depth, bucket);
  }

  let totalRows = 0;
  for (const [, items] of [...byDepth.entries()].sort(
    (left, right) => left[0] - right[0],
  )) {
    const laneEnds: number[] = [];
    for (const item of items.sort(
      (left, right) =>
        left.node.start - right.node.start || right.node.end - left.node.end,
    )) {
      let lane = laneEnds.findIndex((end) => end <= item.node.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = item.node.end;
      item.lane = lane;
      item.row = totalRows + lane;
    }
    totalRows += laneEnds.length;
  }

  const canvas = el("div", "flame-canvas");
  const charCount = Math.max(text.length, 1);
  canvas.style.minWidth = `${Math.max(charCount * 10, 320)}px`;
  canvas.style.height = `${RULER_HEIGHT + totalRows * ROW_HEIGHT + 8}px`;

  const ruler = el("div", "flame-ruler");
  ruler.style.height = `${RULER_HEIGHT}px`;
  if (text.length <= 2000) {
    ruler.style.gridTemplateColumns = `repeat(${charCount}, minmax(0, 1fr))`;
    for (const character of text.split("")) {
      const display =
        character === " "
          ? "·"
          : character === "\t"
            ? "→"
            : character === "\n" || character === "\r"
              ? "¬"
              : character;
      ruler.append(el("span", "flame-ruler__char", display));
    }
  } else {
    ruler.classList.add("flame-ruler--text");
    ruler.textContent = `character ruler hidden for ${text.length.toLocaleString()} characters`;
  }
  canvas.append(ruler);

  for (const item of flat) {
    const { node } = item;
    const bar = el("button", "flame-bar");
    bar.type = "button";
    bar.style.left = `${(node.start / charCount) * 100}%`;
    bar.style.width = `${((node.end - node.start) / charCount) * 100}%`;
    bar.style.minWidth = "6px";
    bar.style.top = `${RULER_HEIGHT + item.row * ROW_HEIGHT}px`;
    bar.style.height = `${BAR_HEIGHT}px`;
    bar.style.background = hierarchyColor(node, 0.24);
    bar.style.borderLeftColor = hierarchySolid(node);
    bar.textContent =
      node.type === "match" ? `match · ${node.covered}` : node.type;
    const parts = [node.type, `[${node.start}:${node.end}]`, node.covered];
    if (node.explanationId) {
      parts.push(`via ${node.explanationId}`);
    }
    bar.title = parts.join(" · ");
    if (node.children.length > 0) {
      bar.classList.add("flame-bar--parent");
    }
    if (node.annotationIndex === undefined) {
      bar.classList.add("flame-bar--synthetic");
    } else {
      const index = node.annotationIndex;
      bar.dataset.annIndex = String(index);
      bar.addEventListener("click", () => setActiveAnnotation(index));
    }
    canvas.append(bar);
  }

  const scroll = el("div", "flame-scroll");
  scroll.append(canvas);
  return scroll as HTMLDivElement;
}

function renderHierarchyTree(roots: HierarchyNode[]): HTMLDivElement {
  const container = el("div", "hierarchy-tree");
  const rootList = el("ul", "hierarchy-list");

  const renderNode = (node: HierarchyNode, parent: HTMLUListElement): void => {
    const item = el("li", "hierarchy-item");
    const button = el("button", "hierarchy-node");
    button.type = "button";
    const dot = el("span", "dot");
    dot.style.background = hierarchySolid(node);
    button.append(dot);
    button.append(el("code", "hierarchy-type", node.type));
    button.append(el("span", "hierarchy-covered", node.covered));
    if (node.explanationId) {
      button.append(el("span", "hierarchy-id", `via ${node.explanationId}`));
    }
    if (node.annotationIndex === undefined) {
      button.disabled = true;
    } else {
      const index = node.annotationIndex;
      button.dataset.annIndex = String(index);
      button.addEventListener("click", () => setActiveAnnotation(index));
    }
    item.append(button);
    if (node.children.length > 0) {
      const children = el("ul", "hierarchy-children");
      for (const child of node.children) {
        renderNode(child, children);
      }
      item.append(children);
    }
    parent.append(item);
  };

  for (const root of roots) {
    renderNode(root, rootList);
  }
  container.append(rootList);
  return container;
}

function renderHierarchy(result: RunResult, prebuilt?: HierarchyResult): void {
  const built = prebuilt ?? buildHierarchy(result, state.text);
  hierarchy.replaceChildren();

  if (built.roots.length === 0) {
    hierarchyNote.textContent = "No derived annotations yet.";
    const empty = el("div", "hierarchy-empty");
    empty.append(
      el(
        "p",
        "empty-state",
        "Enable “explain tags” and try the tag grammar to see tags built from other annotations.",
      ),
    );
    const button = el("button", "small-button", "Try the tag grammar");
    button.type = "button";
    button.addEventListener("click", loadDemoGrammar);
    empty.append(button);
    hierarchy.append(empty);
    return;
  }

  hierarchyNote.textContent =
    built.mode === "derivation"
      ? "Deeper rows are derived from the row above; bar width is the text span."
      : "Showing pattern composition. Enable “explain tags” for tag derivations.";
  hierarchy.append(renderFlame(built.roots, state.text));
  hierarchy.append(renderHierarchyTree(built.roots));
}

function loadDemoGrammar(): void {
  if (!state.text.trim()) {
    state.text = SAMPLE_TEXT;
    textInput.value = SAMPLE_TEXT;
  }
  state.tags = DEMO_GRAMMAR;
  tagsInput.value = DEMO_GRAMMAR;
  state.pattern = "[tag:noun-phrase]";
  patternInput.value = state.pattern;
  state.explain = true;
  explainInput.checked = true;
  state.selected.add("[tag:noun-phrase]");
  renderAnnotatorChips();
  void run();
}

function setActiveAnnotation(index: number): void {
  const wanted = String(index);
  for (const card of annotationList.querySelectorAll<HTMLElement>(
    ".ann-card",
  )) {
    card.classList.toggle("is-active", card.dataset.annIndex === wanted);
  }
  for (const segment of annotatedText.querySelectorAll<HTMLElement>(".seg")) {
    const ids = (segment.dataset.annIds ?? "").split(",");
    segment.classList.toggle("seg--active", ids.includes(wanted));
  }
  for (const bar of hierarchy.querySelectorAll<HTMLElement>(".flame-bar")) {
    bar.classList.toggle("is-active", bar.dataset.annIndex === wanted);
  }
  for (const node of hierarchy.querySelectorAll<HTMLElement>(
    ".hierarchy-node",
  )) {
    node.classList.toggle("is-active", node.dataset.annIndex === wanted);
  }
  const active = annotationList.querySelector<HTMLElement>(
    `.ann-card[data-ann-index="${wanted}"]`,
  );
  active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderResult(result: RunResult): void {
  result.annotations.sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.type.localeCompare(right.type),
  );
  state.lastResult = result;
  const hierarchyResult = buildHierarchy(result, state.text);
  const provenance = buildProvenanceIndex(hierarchyResult.roots);
  const graph = ProvenanceGraph.fromAnnotations(result.annotations, state.text);
  state.provenanceGraph = graph;
  const sourceLabel =
    result.source === "client" ? clientLexiconLabel : "Wiktionary server";
  stats.textContent = `${result.annotations.length} annotations · ${result.interpretations.length} interpretations · ${result.elapsedMs.toFixed(1)} ms · ${sourceLabel}`;
  renderErrors();
  renderAnnotatedText(state.text, result.annotations);
  renderAnnotations(result, provenance, graph);
  renderInterpretations(result);
  renderHierarchy(result, hierarchyResult);
  $<HTMLButtonElement>("#export-svg").disabled = graph.nodes.size === 0;
  $<HTMLButtonElement>("#export-png").disabled = graph.nodes.size === 0;
}

function renderErrors(): void {
  const errors = [...(state.lastResult?.errors ?? [])];
  if (state.error) {
    errors.unshift(state.error);
  }
  errorsBox.hidden = errors.length === 0;
  errorsBox.replaceChildren();
  for (const error of errors) {
    errorsBox.append(el("p", undefined, error));
  }
}

function renderAnnotatorChips(): void {
  annotatorChips.replaceChildren();
  const groups = new Map<string, AnnotatorDescriptor[]>();
  for (const descriptor of ANNOTATORS) {
    const bucket = groups.get(descriptor.group) ?? [];
    bucket.push(descriptor);
    groups.set(descriptor.group, bucket);
  }
  const custom = [...state.selected].filter(
    (expression) =>
      !ANNOTATORS.some((descriptor) => descriptor.expression === expression),
  );
  if (custom.length > 0) {
    groups.set(
      "Custom",
      custom.map((expression) => ({
        expression,
        label: expression,
        group: "Custom",
      })),
    );
  }

  for (const [group, descriptors] of groups) {
    const wrapper = el("div", "chip-group");
    wrapper.append(el("span", "chip-group__label", group));
    const chips = el("div", "chips");
    for (const descriptor of descriptors) {
      const button = el("button", "chip");
      button.type = "button";
      button.textContent = descriptor.label;
      button.title = descriptor.description ?? descriptor.expression;
      const active = state.selected.has(descriptor.expression);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.addEventListener("click", () => {
        if (state.selected.has(descriptor.expression)) {
          state.selected.delete(descriptor.expression);
        } else {
          state.selected.add(descriptor.expression);
        }
        renderAnnotatorChips();
      });
      chips.append(button);
    }
    wrapper.append(chips);
    annotatorChips.append(wrapper);
  }
}

function renderStatus(): void {
  const health = state.serverHealth;
  if (state.mode === "client") {
    statusPill.textContent = `Client · ${clientLexicon.entryCount.toLocaleString()} entries`;
    statusPill.className = "status-pill status-pill--client";
    serverInfo.textContent = `Using ${clientLexiconLabel} (${clientLexicon.wordCount.toLocaleString()} words).`;
  } else if (health?.lexicon) {
    const name = health.lexicon.languageName ?? health.lexicon.language;
    statusPill.textContent = `Server · ${name} · ${health.lexicon.entries.toLocaleString()} entries`;
    statusPill.className = "status-pill status-pill--server";
    serverInfo.textContent = `Full lexicon loaded on the server (${health.lexicon.entries.toLocaleString()} entries).`;
  } else {
    statusPill.textContent = "Server offline";
    statusPill.className = "status-pill status-pill--offline";
    serverInfo.textContent =
      "Start the server with `node web/server.mjs`, then check again.";
  }
  $<HTMLButtonElement>("#mode-client").classList.toggle(
    "is-active",
    state.mode === "client",
  );
  $<HTMLButtonElement>("#mode-server").classList.toggle(
    "is-active",
    state.mode === "server",
  );
}

async function refreshServerStatus(): Promise<void> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const health = (await response.json()) as ServerHealth;
    state.serverHealth = health;
    state.serverAvailable = health.ok !== false && health.lexicon != null;
  } catch {
    state.serverHealth = null;
    state.serverAvailable = false;
  }
  renderStatus();
}

function resetOutput(): void {
  state.lastResult = null;
  state.provenanceGraph = null;
  state.error = "";
  stats.textContent = "No run yet.";
  annotatedText.replaceChildren();
  hierarchy.replaceChildren();
  hierarchyNote.textContent = "";
  annotationList.replaceChildren();
  interpretations.replaceChildren();
  interpretationsSection.hidden = true;
  annCount.textContent = "0";
  interpCount.textContent = "0";
  $<HTMLButtonElement>("#export-svg").disabled = true;
  $<HTMLButtonElement>("#export-png").disabled = true;
  renderErrors();
}

function updateLexiconHint(): void {
  lexiconHint.textContent = `${clientLexicon.wordCount.toLocaleString()} words · ${clientLexicon.entryCount.toLocaleString()} entries in ${clientLexiconLabel}.`;
}
updateLexiconHint();

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportRun(): void {
  if (state.lastResult === null) {
    state.error = "Run an annotation first.";
    renderErrors();
    return;
  }
  const payload = {
    format: "fleximatcher-playground-run",
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: state.mode,
    text: state.text,
    pattern: state.pattern,
    annotators: [...state.selected],
    tags: state.tags,
    result: state.lastResult,
    provenance: state.provenanceGraph?.toJSON() ?? null,
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    }),
    "fleximatcher-run.json",
  );
}

function requireProvenance(): ProvenanceGraph | null {
  const graph = state.provenanceGraph;
  if (graph === null || graph.nodes.size === 0) {
    state.error =
      "No provenance derivations in this run. Enable “explain tags” and use tag rules.";
    renderErrors();
    return null;
  }
  return graph;
}

function exportProvenanceSvg(): void {
  const graph = requireProvenance();
  if (graph === null) return;
  downloadBlob(
    new Blob([graph.toSVG({ width: 1400 })], {
      type: "image/svg+xml",
    }),
    "fleximatcher-provenance.svg",
  );
}

async function exportProvenancePng(): Promise<void> {
  const graph = requireProvenance();
  if (graph === null) return;
  const svg = graph.toSVG({ width: 1400 });
  const svgBlob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("Could not render provenance SVG"));
      image.src = url;
    });
    const documentNode = new DOMParser().parseFromString(svg, "image/svg+xml");
    const width =
      Number(documentNode.documentElement.getAttribute("width")) || 1400;
    const height =
      Number(documentNode.documentElement.getAttribute("height")) || 600;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas is not available");
    }
    context.scale(scale, scale);
    context.fillStyle = "#fffaf2";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob === null
            ? reject(new Error("PNG encoding failed"))
            : resolve(blob),
        "image/png",
      );
    });
    downloadBlob(png, "fleximatcher-provenance.png");
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    renderErrors();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Events
textInput.addEventListener("input", () => {
  state.text = textInput.value;
});
patternInput.addEventListener("input", () => {
  state.pattern = patternInput.value;
});
matchWholeInput.addEventListener("change", () => {
  state.matchWhole = matchWholeInput.checked;
});
explainInput.addEventListener("change", () => {
  state.explain = explainInput.checked;
});
tagsInput.addEventListener("input", () => {
  state.tags = tagsInput.value;
});
customAnnotator.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addCustomAnnotator();
  }
});
$<HTMLButtonElement>("#add-annotator").addEventListener(
  "click",
  addCustomAnnotator,
);

function addCustomAnnotator(): void {
  const chunk = normalizeAnnotator(customAnnotator.value);
  if (!chunk) return;
  state.selected.add(chunk);
  customAnnotator.value = "";
  renderAnnotatorChips();
}

$<HTMLButtonElement>("#run-button").addEventListener("click", () => {
  void run();
});
$<HTMLButtonElement>("#export-run").addEventListener("click", exportRun);
$<HTMLButtonElement>("#export-svg").addEventListener(
  "click",
  exportProvenanceSvg,
);
$<HTMLButtonElement>("#export-png").addEventListener("click", () => {
  void exportProvenancePng();
});
$<HTMLButtonElement>("#sample-button").addEventListener("click", () => {
  state.text = SAMPLE_TEXT;
  state.pattern = SAMPLE_PATTERN;
  state.selected = new Set(DEFAULT_SELECTED);
  textInput.value = state.text;
  patternInput.value = state.pattern;
  renderAnnotatorChips();
  resetOutput();
  void run();
});
$<HTMLButtonElement>("#sample-pattern").addEventListener("click", () => {
  state.pattern = SAMPLE_PATTERN;
  patternInput.value = SAMPLE_PATTERN;
});
$<HTMLButtonElement>("#demo-grammar").addEventListener(
  "click",
  loadDemoGrammar,
);
$<HTMLButtonElement>("#clear-button").addEventListener("click", () => {
  state.text = "";
  state.pattern = "";
  state.selected = new Set();
  textInput.value = "";
  patternInput.value = "";
  renderAnnotatorChips();
  resetOutput();
});
$<HTMLButtonElement>("#mode-client").addEventListener("click", () => {
  state.mode = "client";
  renderStatus();
});
$<HTMLButtonElement>("#mode-server").addEventListener("click", () => {
  state.mode = "server";
  renderStatus();
  void refreshServerStatus();
});
$<HTMLButtonElement>("#refresh-server").addEventListener("click", () => {
  void refreshServerStatus();
});

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void run();
  }
});

$<HTMLInputElement>("#tags-file").addEventListener("change", async (event) => {
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  if (!file) return;
  tagsInput.value = await file.text();
  state.tags = tagsInput.value;
});

$<HTMLInputElement>("#lexicon-file").addEventListener(
  "change",
  async (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as WiktionaryLexiconData;
      clientLexicon = WiktionaryLexicon.fromData(data);
      clientLexiconLabel = file.name;
      updateLexiconHint();
      renderStatus();
      state.error = "";
      renderErrors();
    } catch (error) {
      state.error = `Could not load lexicon: ${error instanceof Error ? error.message : String(error)}`;
      renderErrors();
    }
  },
);

// Initial paint and demo run.
renderAnnotatorChips();
renderStatus();
updateLexiconHint();
void refreshServerStatus();
resetOutput();
void run();
