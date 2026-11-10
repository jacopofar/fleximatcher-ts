import { describe, expect, it } from "vitest";

import { FlexiMatcher, ProvenanceGraph } from "../src/index.js";

function buildGraph(): {
  matcher: FlexiMatcher;
  graph: ProvenanceGraph;
  fruit: ReturnType<FlexiMatcher["matches"]>["store"]["annotations"][number];
} {
  const matcher = new FlexiMatcher();
  matcher.addTagRule("fruit", "pear", {
    identifier: "id_fruit",
    template: { lemma: "pear" },
  });
  matcher.addTagRule("a", "[tag:fruit]", {
    identifier: "id_a",
    template: { via: "a" },
  });
  matcher.addTagRule("b", "[tag:fruit]", {
    identifier: "id_b",
    template: { via: "b" },
  });
  matcher.addTagRule("root", "[tag:a]", {
    identifier: "id_root_a",
    template: { via: "rootA" },
  });
  matcher.addTagRule("root", "[tag:b]", {
    identifier: "id_root_b",
    template: { via: "rootB" },
  });

  const result = matcher.matches("pear", "[tag:root]", {
    explain: true,
    populateResult: true,
  });
  const graph = ProvenanceGraph.fromAnnotations(result.store.annotations, "pear");
  const fruit = result.store.annotations.find(
    (annotation) => annotation.type === "[tag:fruit]",
  );
  if (fruit === undefined) {
    throw new Error("fruit annotation missing");
  }
  return { matcher, graph, fruit };
}

describe("provenance graph", () => {
  it("shares a child used by several derivations", () => {
    const { graph, fruit } = buildGraph();
    const node = graph.nodeFor(fruit);
    expect(node).toBeDefined();
    expect(node?.parents).toHaveLength(2);

    const paths = graph.why(fruit);
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path.at(-1)?.type).toBe("[tag:fruit]");
      expect(path[0]?.type).toBe("[tag:root]");
    }
    expect(graph.roots).toHaveLength(2);
  });

  it("exports JSON and SVG", () => {
    const { graph, fruit } = buildGraph();
    const json = graph.toJSON();
    expect(json.format).toBe("fleximatcher-provenance");
    expect(json.nodes.length).toBe(5);
    expect(json.edges.length).toBe(4);
    expect(json.text).toBe("pear");

    const svg = graph.toSVG({ width: 800, rowHeight: 30 });
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("[tag:fruit]");

    expect(graph.nodeFor(fruit)?.annotation).toBe(fruit);
    expect(graph.why("not-a-node")).toEqual([]);
  });

  it("returns an empty graph when there are no explanations", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.matches("pear", "[i:pear]");
    const graph = ProvenanceGraph.fromAnnotations(result.store.annotations, "pear");
    expect(graph.nodes.size).toBe(0);
    expect(graph.roots).toEqual([]);
    expect(graph.toJSON().nodes).toEqual([]);
    expect(graph.toSVG()).toContain("No provenance derivations");
  });
});
