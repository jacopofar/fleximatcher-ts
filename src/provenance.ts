/**
 * Provenance graphs for tag derivations.
 *
 * Tag annotations produced with `explain: true` record their children in
 * `data.__explain`.  A single child annotation can be used by several parent
 * derivations.  This module turns those references into a shared DAG with
 * stable node IDs, so the same child is one node with multiple parents rather
 * than a duplicated tree.
 */

/** The structural shape needed to build or query provenance. */
export interface ProvenanceAnnotationLike {
  start: number;
  end: number;
  type: string;
  data?: unknown;
  /** Present when the input is a real Annotation. */
  key?: string;
}

export interface ProvenanceNode {
  /** Stable node ID.  Annotation-backed nodes use `annotation.key`. */
  id: string;
  type: string;
  start: number;
  end: number;
  covered: string;
  data?: unknown;
  explanationId: string | null;
  parents: string[];
  children: string[];
  /** The backing annotation, when one exists in the store. */
  annotation?: ProvenanceAnnotationLike;
}

export interface ProvenanceEdge {
  from: string;
  to: string;
}

export interface ProvenanceJSON {
  format: "fleximatcher-provenance";
  version: 1;
  text: string;
  roots: string[];
  nodes: Array<{
    id: string;
    type: string;
    start: number;
    end: number;
    covered: string;
    data?: unknown;
    explanationId: string | null;
    parents: string[];
    children: string[];
  }>;
  edges: ProvenanceEdge[];
}

export interface ProvenanceSVGOptions {
  width?: number;
  rowHeight?: number;
}

export interface ProvenanceGraphOptions {
  /** Include literal text chunks as leaf nodes.  Defaults to false. */
  includeLiterals?: boolean;
}

interface ExplainLike {
  id?: unknown;
  children?: unknown[];
}

interface ChildLike {
  start: number;
  end: number;
  type: string;
  explanation: ExplainLike | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function explanationOf(value: unknown): ExplainLike | null {
  const record = isRecord(value) ? value : null;
  if (record === null) return null;
  const explain = isRecord(record.__explain) ? record.__explain : null;
  return explain === null ? null : explain;
}

function toChild(value: unknown): ChildLike | null {
  if (!isRecord(value)) return null;
  const { start, end, type } = value;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    typeof type !== "string"
  ) {
    return null;
  }
  const explain = explanationOf({ __explain: value.__explain });
  return { start, end, type, explanation: explain };
}

function spanTypeKey(value: {
  start: number;
  end: number;
  type: string;
}): string {
  return `${value.start}:${value.end}:${value.type}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function hueFor(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % 360;
}

export class ProvenanceGraph {
  readonly text: string;
  readonly nodes = new Map<string, ProvenanceNode>();
  readonly edges: ProvenanceEdge[] = [];
  readonly roots: string[] = [];
  private readonly bySpanType = new Map<string, ProvenanceAnnotationLike>();
  private readonly bySpanTypeNodes = new Map<string, ProvenanceNode>();
  private readonly edgeKeys = new Set<string>();

  private constructor(text: string) {
    this.text = text;
  }

  /** Build a shared provenance DAG from explained annotations. */
  static fromAnnotations(
    annotations: readonly ProvenanceAnnotationLike[],
    text: string,
    options: ProvenanceGraphOptions = {},
  ): ProvenanceGraph {
    const graph = new ProvenanceGraph(text);
    const includeLiterals = options.includeLiterals ?? false;
    for (const annotation of annotations) {
      const key = spanTypeKey(annotation);
      if (!graph.bySpanType.has(key)) {
        graph.bySpanType.set(key, annotation);
      }
    }

    const path = new Set<string>();

    const addNode = (
      value: { start: number; end: number; type: string },
      annotation?: ProvenanceAnnotationLike,
    ): ProvenanceNode => {
      const id =
        annotation?.key ?? `synthetic:${value.start}:${value.end}:${value.type}`;
      let node = graph.nodes.get(id);
      if (node !== undefined) {
        return node;
      }
      const data = annotation?.data;
      const explanation = annotation === undefined
        ? null
        : explanationOf(data);
      node = {
        id,
        type: annotation?.type ?? value.type,
        start: annotation?.start ?? value.start,
        end: annotation?.end ?? value.end,
        covered: text.slice(
          annotation?.start ?? value.start,
          annotation?.end ?? value.end,
        ),
        data,
        explanationId:
          explanation !== null && typeof explanation.id === "string"
            ? explanation.id
            : null,
        parents: [],
        children: [],
        annotation,
      };
      graph.nodes.set(id, node);
      const spanKey = spanTypeKey(node);
      if (!graph.bySpanTypeNodes.has(spanKey)) {
        graph.bySpanTypeNodes.set(spanKey, node);
      }
      return node;
    };

    const addEdge = (parent: ProvenanceNode, child: ProvenanceNode): void => {
      if (parent.id === child.id) return;
      const key = `${parent.id}\u0000${child.id}`;
      if (graph.edgeKeys.has(key)) return;
      graph.edgeKeys.add(key);
      parent.children.push(child.id);
      child.parents.push(parent.id);
      graph.edges.push({ from: parent.id, to: child.id });
    };

    const addChildren = (
      parent: ProvenanceNode,
      children: unknown[],
    ): void => {
      for (const raw of children) {
        const child = toChild(raw);
        if (child === null) continue;
        const found = graph.bySpanType.get(spanTypeKey(child));
        const explanation =
          child.explanation ??
          (found === undefined ? null : explanationOf(found.data));
        if (
          !includeLiterals &&
          !child.type.startsWith("[") &&
          explanation === null
        ) {
          continue;
        }
        const childNode = addNode(child, found);
        addEdge(parent, childNode);
        if (explanation === null || path.has(childNode.id)) {
          continue;
        }
        path.add(childNode.id);
        addChildren(childNode, explanation.children ?? []);
        path.delete(childNode.id);
      }
    };

    for (const annotation of annotations) {
      const explanation = explanationOf(annotation.data);
      if (explanation === null) continue;
      const node = addNode(annotation, annotation);
      if (path.has(node.id)) continue;
      path.add(node.id);
      addChildren(node, explanation.children ?? []);
      path.delete(node.id);
    }

    for (const node of graph.nodes.values()) {
      if (node.parents.length === 0) {
        graph.roots.push(node.id);
      }
    }
    graph.roots.sort();

    return graph;
  }

  /** Resolve a node by stable ID, backing annotation, or span/type. */
  nodeFor(
    target: string | ProvenanceAnnotationLike,
  ): ProvenanceNode | undefined {
    if (typeof target === "string") {
      return this.nodes.get(target) ?? this.bySpanTypeNodes.get(target);
    }
    if (target.key !== undefined) {
      const byKey = this.nodes.get(target.key);
      if (byKey !== undefined) return byKey;
    }
    return this.bySpanTypeNodes.get(spanTypeKey(target));
  }

  /**
   * Return every root-to-node path for an annotation or node ID.
   *
   * A shared child yields one path per parent chain.  An annotation outside
   * the provenance graph has no paths.
   */
  why(target: string | ProvenanceAnnotationLike): ProvenanceNode[][] {
    const node = this.nodeFor(target);
    if (node === undefined) return [];
    const paths: ProvenanceNode[][] = [];

    const walk = (current: ProvenanceNode, suffix: ProvenanceNode[]): void => {
      const next = [current, ...suffix];
      if (current.parents.length === 0) {
        paths.push(next);
        return;
      }
      for (const parentId of current.parents) {
        if (next.some((item) => item.id === parentId)) continue;
        const parent = this.nodes.get(parentId);
        if (parent !== undefined) {
          walk(parent, next);
        }
      }
    };

    walk(node, []);
    return paths;
  }

  /** Serialize the DAG as JSON. */
  toJSON(): ProvenanceJSON {
    const nodes = [...this.nodes.values()]
      .sort(
        (left, right) =>
          left.start - right.start ||
          left.end - right.end ||
          left.type.localeCompare(right.type) ||
          left.id.localeCompare(right.id),
      )
      .map((node) => ({
        id: node.id,
        type: node.type,
        start: node.start,
        end: node.end,
        covered: node.covered,
        data: node.data,
        explanationId: node.explanationId,
        parents: [...node.parents],
        children: [...node.children],
      }));
    return {
      format: "fleximatcher-provenance",
      version: 1,
      text: this.text,
      roots: [...this.roots],
      nodes,
      edges: [...this.edges],
    };
  }

  /** Render a simple layered SVG of the provenance DAG. */
  toSVG(options: ProvenanceSVGOptions = {}): string {
    const width = options.width ?? 1200;
    const rowHeight = options.rowHeight ?? 36;
    const margin = 22;
    const top = 38;

    if (this.nodes.size === 0) {
      return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="80">`,
        `<rect width="100%" height="100%" fill="#fffaf2"/>`,
        `<text x="${margin}" y="42" font-family="monospace" font-size="12" fill="#756b60">`,
        `No provenance derivations`,
        `</text>`,
        `</svg>`,
      ].join("");
    }

    const depthCache = new Map<string, number>();
    const depth = (node: ProvenanceNode, stack = new Set<string>()): number => {
      const cached = depthCache.get(node.id);
      if (cached !== undefined) return cached;
      if (stack.has(node.id) || node.parents.length === 0) {
        depthCache.set(node.id, 0);
        return 0;
      }
      stack.add(node.id);
      let value = 0;
      for (const parentId of node.parents) {
        const parent = this.nodes.get(parentId);
        if (parent !== undefined) {
          value = Math.max(value, depth(parent, stack) + 1);
        }
      }
      stack.delete(node.id);
      depthCache.set(node.id, value);
      return value;
    };

    interface Positioned {
      node: ProvenanceNode;
      depth: number;
      lane: number;
      row: number;
      x: number;
      y: number;
      w: number;
      h: number;
    }

    const byDepth = new Map<number, ProvenanceNode[]>();
    for (const node of this.nodes.values()) {
      const d = depth(node);
      const bucket = byDepth.get(d) ?? [];
      bucket.push(node);
      byDepth.set(d, bucket);
    }

    const positioned = new Map<string, Positioned>();
    let totalRows = 0;
    for (const [d, nodes] of [...byDepth.entries()].sort(
      (left, right) => left[0] - right[0],
    )) {
      const laneEnds: number[] = [];
      for (const node of nodes.sort(
        (left, right) =>
          left.start - right.start ||
          right.end - left.end ||
          left.type.localeCompare(right.type),
      )) {
        let lane = laneEnds.findIndex((end) => end <= node.start);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(0);
        }
        laneEnds[lane] = node.end;
        const charLength = Math.max(this.text.length, 1);
        const x =
          margin + (node.start / charLength) * (width - margin * 2);
        const w = Math.max(
          8,
          ((node.end - node.start) / charLength) * (width - margin * 2),
        );
        positioned.set(node.id, {
          node,
          depth: d,
          lane,
          row: totalRows + lane,
          x,
          y: top + (totalRows + lane) * rowHeight,
          w,
          h: rowHeight - 8,
        });
      }
      totalRows += laneEnds.length;
    }

    const height = top + totalRows * rowHeight + 18;
    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect width="100%" height="100%" fill="#fffaf2"/>`,
      `<text x="${margin}" y="22" font-family="monospace" font-size="11" fill="#756b60">Fleximatcher provenance · ${escapeXml(this.text.slice(0, 90))}</text>`,
    ];

    for (const edge of this.edges) {
      const from = positioned.get(edge.from);
      const to = positioned.get(edge.to);
      if (from === undefined || to === undefined) continue;
      const x1 = from.x + from.w / 2;
      const y1 = from.y + from.h;
      const x2 = to.x + to.w / 2;
      const y2 = to.y;
      parts.push(
        `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${((y1 + y2) / 2).toFixed(1)}, ${x2.toFixed(1)} ${((y1 + y2) / 2).toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="#c8b9a8" stroke-width="1"/>`,
      );
    }

    for (const { node, x, y, w, h } of positioned.values()) {
      const hue = hueFor(node.type);
      parts.push(
        `<g><title>${escapeXml(`${node.type} [${node.start}:${node.end}] ${node.covered}`)}</title>`,
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="5" fill="hsl(${hue} 72% 52% / 0.22)" stroke="hsl(${hue} 65% 44%)" stroke-width="1.5"/>`,
      );
      if (w > 48) {
        const label = node.type.length > Math.floor(w / 6) ? node.type.slice(0, Math.floor(w / 6)) : node.type;
        parts.push(
          `<text x="${(x + 4).toFixed(1)}" y="${(y + 14).toFixed(1)}" font-family="monospace" font-size="9" fill="#25211c">${escapeXml(label)}</text>`,
        );
      }
      parts.push(`</g>`);
    }

    parts.push(`</svg>`);
    return parts.join("");
  }
}
