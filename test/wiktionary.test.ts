import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FlexiMatcher, PatternError } from "../src/index.js";
import {
  entryMatchesQuery,
  loadWiktionaryLexicon,
  parseWiktionaryQuery,
  registerWiktionaryRules,
  tokenizeWords,
  transformEntry,
  WiktionaryLexicon,
  WiktionaryRuleFactory,
  type WiktionaryEntry,
} from "../src/wiktionary/index.js";
import { buildLexicon } from "../src/wiktionary/build.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/wiktionary-it.json", import.meta.url),
);

function setup(): { lexicon: WiktionaryLexicon; matcher: FlexiMatcher } {
  const lexicon = WiktionaryLexicon.fromData(
    JSON.parse(readFileSync(fixturePath, "utf8")),
  );
  const matcher = new FlexiMatcher();
  registerWiktionaryRules(matcher, lexicon, { prefix: "it" });
  return { lexicon, matcher };
}

describe("Wiktionary lexicon", () => {
  it("loads metadata, entries and normalized lookups", async () => {
    const lexicon = await loadWiktionaryLexicon(fixturePath);
    expect(lexicon.language).toBe("it");
    expect(lexicon.languageName).toBe("Italian");
    expect(lexicon.wordCount).toBeGreaterThan(10);
    expect(lexicon.lookup("Casa").map((entry) => entry.lemma)).toContain("casa");
    expect(lexicon.lookup("DELL’").map((entry) => entry.word)).toContain("dell'");
    expect(lexicon.lookup("missing")).toEqual([]);
  });

  it("deduplicates entries while merging declension information", () => {
    const lexicon = WiktionaryLexicon.fromEntries(
      [
        {
          word: "casa",
          lemma: "casa",
          pos: "noun",
          features: ["lemma", "feminine", "singular"],
        },
        {
          word: "casa",
          lemma: "casa",
          pos: "noun",
          features: ["lemma", "feminine", "singular"],
          declension: "it-noun:f",
        },
      ],
      { language: "it" },
    );
    expect(lexicon.entryCount).toBe(1);
    expect(lexicon.lookup("casa")[0]?.declension).toBe("it-noun:f");
  });

  it("filters by POS while loading", async () => {
    const lexicon = await loadWiktionaryLexicon(fixturePath, { pos: ["noun"] });
    expect(lexicon.entryCount).toBeGreaterThan(0);
    for (const entry of lexicon.entries()) {
      expect(entry.pos).toBe("noun");
    }
    expect(lexicon.lookup("libero")).toEqual([]);
    expect(lexicon.lookup("casa")[0]?.pos).toBe("noun");
  });
});

describe("Wiktionary tokenizer", () => {
  it("keeps apostrophe pieces and drops punctuation", () => {
    const tokens = tokenizeWords("L'uomo dell'acqua, po'!");
    expect(tokens.map((token) => token.text)).toContain("L'");
    expect(tokens.map((token) => token.text)).toContain("uomo");
    expect(tokens.map((token) => token.text)).toContain("dell'");
    expect(tokens.map((token) => token.text)).toContain("acqua");
    expect(tokens.map((token) => token.text)).toContain("po'");
    expect(tokens.map((token) => token.text)).not.toContain(",");
  });

  it("has correct UTF-16 spans", () => {
    const text = "L'uomo";
    const tokens = tokenizeWords(text);
    const uomo = tokens.find((token) => token.text === "uomo");
    expect(uomo).toBeDefined();
    expect(text.slice(uomo!.start, uomo!.end)).toBe("uomo");
  });
});

describe("Wiktionary queries", () => {
  it("parses features, fields and exclusions", () => {
    const query = parseWiktionaryQuery(
      "feminine plural !derived g=f number=p case=accusative person=3 mood=indicative tense=present verbForm=participle declension=it-noun:f lemma=Casa",
    );
    expect(query.features).toEqual(["feminine", "plural"]);
    expect(query.excludedFeatures).toEqual(["derived"]);
    expect(query.fields.gender).toEqual(["f"]);
    expect(query.fields.number).toEqual(["p"]);
    expect(query.fields.case).toEqual(["accusative"]);
    expect(query.fields.person).toEqual(["3"]);
    expect(query.fields.mood).toEqual(["indicative"]);
    expect(query.fields.tense).toEqual(["present"]);
    expect(query.fields.verbForm).toEqual(["participle"]);
    expect(query.fields.declension).toEqual(["it-noun:f"]);
    expect(query.fields.lemma).toEqual(["casa"]);
  });

  it("supports alternatives within a field", () => {
    const query = parseWiktionaryQuery("gender=m|f number=p");
    const entry: WiktionaryEntry = {
      word: "liberi",
      lemma: "libero",
      pos: "adj",
      features: ["inflected", "masculine", "plural"],
      gender: "m",
      number: "p",
    };
    expect(entryMatchesQuery(entry, query)).toBe(true);
  });

  it("rejects invalid and unknown fields", () => {
    expect(() => parseWiktionaryQuery("gender=x")).toThrow(PatternError);
    expect(() => parseWiktionaryQuery("number=maybe")).toThrow(PatternError);
    expect(() => parseWiktionaryQuery("person=7")).toThrow(PatternError);
    expect(() => parseWiktionaryQuery("nonsense=x")).toThrow(PatternError);
  });
});

describe("Wiktionary rules", () => {
  it("matches word classes and inflections", () => {
    const { matcher } = setup();
    expect(matcher.matches("La casa è bella", "La [it-noun:feminine singular] è bella").matching).toBe(true);
    expect(matcher.matches("Le case", "Le [it-noun:feminine plural]").matching).toBe(true);
    expect(matcher.matches("L'uomo", "L'[it-noun:masculine singular]").matching).toBe(true);
    expect(
      matcher.matches(
        "dell'acqua",
        "[it-contraction][it-noun:feminine singular]",
      ).matching,
    ).toBe(true);
    expect(matcher.matches("libere", "[it-adj:feminine plural]").matching).toBe(true);
    expect(matcher.matches("dà", "[it-verb:third-person singular present indicative]").matching).toBe(true);
    expect(matcher.matches("dato", "[it-verb:past participle]").matching).toBe(true);
    expect(matcher.matches("sempre", "[it-adv]").matching).toBe(true);
    expect(matcher.matches("Dio", "[it-name]").matching).toBe(true);
    expect(matcher.matches("le", "[it-article]").matching).toBe(true);
    expect(matcher.matches("di", "[it-prep]").matching).toBe(true);
    expect(matcher.matches("e", "[it-conj]").matching).toBe(true);
    expect(matcher.matches("questo", "[it-det]").matching).toBe(true);
    expect(matcher.matches("egli", "[it-pron]").matching).toBe(true);
    expect(matcher.matches("lo", "[it-pron:case=accusative]").matching).toBe(true);
    expect(matcher.matches("gli", "[it-pron:case=dative]").matching).toBe(true);
    expect(matcher.matches("uno", "[it-num]").matching).toBe(true);
  });

  it("handles homographs by POS", () => {
    const { matcher } = setup();
    expect(matcher.matches("porta", "[it-noun]").matching).toBe(true);
    expect(matcher.matches("porta", "[it-verb]").matching).toBe(true);
    expect(matcher.matches("porta", "[it-adj]").matching).toBe(false);
  });

  it("filters by structured features and exclusions", () => {
    const { matcher } = setup();
    expect(matcher.matches("case", "[it-noun:gender=f number=p]").matching).toBe(true);
    expect(matcher.matches("case", "[it-noun:gender=f number=p !derived]").matching).toBe(true);
    expect(matcher.matches("casina", "[it-noun:diminutive]").matching).toBe(true);
    expect(matcher.matches("casina", "[it-noun:!derived]").matching).toBe(false);
    expect(matcher.matches("casa", "[it-noun:declension=it-noun:f]").matching).toBe(true);
    expect(matcher.matches("case", "[it-noun:lemma=casa]").matching).toBe(true);
    expect(matcher.matches("liberi", "[it-adj:gender=m|f number=p]").matching).toBe(true);
    expect(matcher.matches("dà", "[it-verb:person=3 number=s tense=present mood=indicative]").matching).toBe(true);
  });

  it("exposes lemma, features and structured fields in annotations", () => {
    const { matcher } = setup();
    const result = matcher.matches(
      "dà",
      "[it-verb:third-person singular present indicative]",
      { populateResult: true },
    );
    const data = result.interpretations?.[0]?.[0]?.data as Record<string, unknown>;
    expect(data).toMatchObject({
      source: "wiktionary",
      language: "it",
      word: "dà",
      lemma: "dare",
      pos: "verb",
      person: "3",
      number: "s",
      mood: "indicative",
      tense: "present",
      declension: "it-verb:a/@",
    });
  });

  it("generates samples from matching entries", () => {
    const { lexicon, matcher } = setup();
    const sample = matcher.generateSample("[it-noun:diminutive]");
    expect(sample).toBe("casina");
    const noun = matcher.generateSample("[it-noun]");
    expect(noun).toBeTruthy();
    expect(lexicon.lookup(noun!).some((entry) => entry.pos === "noun")).toBe(true);
  });

  it("supports custom bindings and a prefixless rule namespace", () => {
    const lexicon = WiktionaryLexicon.fromData(
      JSON.parse(readFileSync(fixturePath, "utf8")),
    );
    const matcher = new FlexiMatcher();
    registerWiktionaryRules(matcher, lexicon, {
      prefix: "",
      includeDefaults: false,
      pos: { nominal: ["noun", "name"] },
    });
    expect(matcher.matches("Dio", "[nominal]").matching).toBe(true);
    expect(matcher.matches("casa", "[nominal]").matching).toBe(true);
    expect(matcher.isBoundRule("noun")).toBe(false);
  });

  it("can be used directly through the factory", () => {
    const lexicon = WiktionaryLexicon.fromData(
      JSON.parse(readFileSync(fixturePath, "utf8")),
    );
    const matcher = new FlexiMatcher();
    matcher.bind("nominal", new WiktionaryRuleFactory(lexicon, { pos: ["noun", "name"] }));
    expect(matcher.matches("uomini", "[nominal:masculine plural]").matching).toBe(true);
  });
});

describe("Wiktextract transformation", () => {
  it("builds lemma, plural and diminutive entries for a noun", () => {
    const entries = transformEntry({
      word: "casa",
      lang_code: "it",
      pos: "noun",
      head_templates: [{ name: "it-noun", args: { "1": "f" } }],
      senses: [{ tags: ["feminine"] }],
      forms: [
        { form: "case", tags: ["plural"] },
        { form: "casina", tags: ["diminutive"] },
      ],
    });
    const byWord = new Map(entries.map((entry) => [entry.word, entry]));
    expect(byWord.get("casa")?.features).toEqual(
      expect.arrayContaining(["lemma", "feminine", "singular"]),
    );
    expect(byWord.get("casa")?.declension).toBe("it-noun:f");
    expect(byWord.get("case")?.features).toEqual(
      expect.arrayContaining(["inflected", "feminine", "plural"]),
    );
    expect(byWord.get("casina")?.features).toEqual(
      expect.arrayContaining(["inflected", "derived", "diminutive"]),
    );
  });

  it("infers adjective gender and plural forms", () => {
    const entries = transformEntry({
      word: "libero",
      lang_code: "it",
      pos: "adj",
      head_templates: [{ name: "it-adj", args: {} }],
      forms: [
        { form: "libera", tags: ["feminine"] },
        { form: "liberi", tags: ["masculine", "plural"] },
        { form: "libere", tags: ["feminine", "plural"] },
        { form: "liberissimo", tags: ["superlative"] },
      ],
    });
    const byWord = new Map(entries.map((entry) => [entry.word, entry]));
    expect(byWord.get("libero")?.features).toEqual(
      expect.arrayContaining(["lemma", "masculine", "singular"]),
    );
    expect(byWord.get("libera")?.features).toEqual(
      expect.arrayContaining(["inflected", "feminine", "singular"]),
    );
    expect(byWord.get("liberi")?.features).toEqual(
      expect.arrayContaining(["inflected", "masculine", "plural"]),
    );
    expect(byWord.get("liberissimo")?.features).toContain("derived");
  });

  it("handles verb forms, participles and auxiliary markers", () => {
    const entries = transformEntry({
      word: "dare",
      lang_code: "it",
      pos: "verb",
      head_templates: [{ name: "it-verb", args: { "1": "a/@" } }],
      senses: [{ tags: ["transitive"] }],
      forms: [
        { form: "dàre", tags: ["canonical"] },
        { form: "dò", tags: ["first-person", "present", "singular"] },
        { form: "dàto", tags: ["participle", "past"] },
        { form: "avére", tags: ["auxiliary"] },
        { form: "irregular", tags: ["table-tags"], source: "conjugation" },
      ],
    });
    const byWord = new Map(entries.map((entry) => [entry.word, entry]));
    expect(byWord.get("dare")?.features).toEqual(
      expect.arrayContaining(["lemma", "infinitive"]),
    );
    expect(byWord.get("dò")?.features).toEqual(
      expect.arrayContaining(["inflected", "first-person", "present", "singular"]),
    );
    expect(byWord.get("dò")?.features).not.toContain("infinitive");
    expect(byWord.get("dàto")?.features).toEqual(
      expect.arrayContaining(["inflected", "participle", "past"]),
    );
    expect(byWord.has("avére")).toBe(false);
    expect(byWord.has("irregular")).toBe(false);
  });

  it("turns a form-of participle into a lemma-linked entry", () => {
    const entries = transformEntry({
      word: "barato",
      lang_code: "it",
      pos: "verb",
      head_templates: [{ name: "it-pp", args: {} }],
      senses: [{ form_of: [{ word: "barare" }], tags: ["form-of", "participle", "past"] }],
      forms: [
        { form: "barata", tags: ["feminine"] },
        { form: "barati", tags: ["masculine", "plural"] },
      ],
    });
    const byWord = new Map(entries.map((entry) => [entry.word, entry]));
    expect(byWord.get("barato")?.lemma).toBe("barare");
    expect(byWord.get("barato")?.features).toEqual(
      expect.arrayContaining([
        "inflected",
        "participle",
        "past",
        "masculine",
        "singular",
      ]),
    );
    expect(byWord.get("barata")?.features).toEqual(
      expect.arrayContaining(["inflected", "participle", "past", "feminine", "singular"]),
    );
  });

  it("marks derived feminine nouns", () => {
    const entries = transformEntry({
      word: "abate",
      lang_code: "it",
      pos: "noun",
      head_templates: [{ name: "it-noun", args: { "1": "m" } }],
      senses: [{ tags: ["masculine"] }],
      forms: [{ form: "badessa", tags: ["feminine"] }],
    });
    const badessa = entries.find((entry) => entry.word === "badessa");
    expect(badessa?.features).toContain("derived");
    expect(badessa?.features).toContain("feminine");
  });

  it("lets a form's case override the base case", () => {
    const entries = transformEntry({
      word: "gli",
      lang_code: "it",
      pos: "pron",
      senses: [{ tags: ["dative", "masculine", "plural"] }],
      forms: [{ form: "lo", tags: ["accusative", "masculine", "singular"] }],
    });
    const lo = entries.find((entry) => entry.word === "lo");
    expect(lo?.features).toContain("accusative");
    expect(lo?.features).not.toContain("dative");
    expect(lo?.features).toContain("singular");
  });

  it("skips multiword entries", () => {
    expect(
      transformEntry({
        word: "a mano",
        lang_code: "it",
        pos: "prep_phrase",
        senses: [{ tags: [] }],
      }),
    ).toEqual([]);
  });

  it("skips punctuation and unparseable form-of descriptions", () => {
    expect(
      transformEntry({
        word: "…",
        lang_code: "it",
        pos: "punct",
        senses: [{ tags: [] }],
      }),
    ).toEqual([]);
    expect(
      transformEntry({
        word: "gli",
        lang_code: "it",
        pos: "article",
        senses: [
          {
            form_of: [{ word: "the article i" }],
            tags: ["form-of", "masculine", "plural"],
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("Wiktionary builder", () => {
  it("streams JSONL input into a loadable lexicon", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fleximatcher-wiktionary-"));
    try {
      const input = join(directory, "raw.jsonl");
      const output = join(directory, "lexicon.jsonl");
      const gzOutput = join(directory, "lexicon.jsonl.gz");
      writeFileSync(
        input,
        [
          JSON.stringify({
            word: "casa",
            lang_code: "it",
            pos: "noun",
            head_templates: [{ name: "it-noun", args: { "1": "f" } }],
            senses: [{ tags: ["feminine"] }],
            forms: [{ form: "case", tags: ["plural"] }],
          }),
          JSON.stringify({
            word: "house",
            lang_code: "en",
            pos: "noun",
            senses: [{ tags: [] }],
          }),
        ].join("\n"),
        "utf8",
      );

      const stats = await buildLexicon({
        input,
        output,
        language: "it",
        log: () => {},
      });
      expect(stats.matched).toBe(1);
      expect(stats.written).toBe(2);

      const plain = await loadWiktionaryLexicon(output);
      expect(plain.language).toBe("it");
      expect(plain.lookup("case").map((entry) => entry.lemma)).toEqual(["casa"]);

      const gzStats = await buildLexicon({
        input,
        output: gzOutput,
        language: "it",
        log: () => {},
      });
      expect(gzStats.written).toBe(2);
      const gzipped = await loadWiktionaryLexicon(gzOutput);
      expect(gzipped.lookup("casa")[0]?.pos).toBe("noun");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
