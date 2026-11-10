import type { WiktionaryLexiconData } from "fleximatcher/wiktionary/browser";

import raw from "./demo-lexicon.json?raw";

export const demoLexiconData = JSON.parse(raw) as WiktionaryLexiconData;
