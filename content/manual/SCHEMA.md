# Study Guide chapter format (one JSON file per chapter: content/manual/<slug>.json)

Every rendered sentence must come from a fact in `facts` (with its source URL). Plain English, short sentences, US spelling for
non-French words, no claims beyond the sources. Aim: what a Court of Master Sommeliers Level 1 (Introductory) candidate must know.

{
  "number": 5,                      // chapter number (see list below)
  "slug": "italy",
  "title": "Italy",                 // shown big, e.g. ITALY
  "script": "Chapter five",         // small script line above the title
  "lead": "One or two sentences: what this chapter covers.",
  "minutes": 20,                    // reading time estimate
  "intro": {                        // optional dark "Start here" band at the top
    "script": "Start here", "title": "THE LABEL TIERS", "text": "1-2 sentences.",
    "tiers": [ { "name": "DOCG", "note": "short note" }, ... ]   // 2-4 rows, top tier first
  },
  "sections": [                     // 3-8 sections (regions, or topics for non-region chapters)
    {
      "name": "Piedmont",
      "book": "wine/italy/piedmont",                     // optional: a page slug that exists in the app (ask the lead dev's list; omit if unsure)
      "lines": [ { "label": "Climate", "text": "1-2 sentences." } ],   // 1-2 labelled short paragraphs
      "chips": { "label": "Grapes", "items": ["Nebbiolo", "Barbera"] }, // optional
      "know": [ "3-5 one-sentence facts most likely to be examined" ],
      "visuals": [ BLOCK, ... ]                          // 1-2 blocks that teach something at a glance
    }
  ],
  "mixups": [ { "a": "Barolo", "b": "Barbaresco", "why": "one line" } ],   // 3-4 pairs people confuse
  "sources": "One sentence naming the bodies/documents used, and 'Checked <date>'.",
  "cards": [ { "q": "question", "answer": "right answer", "wrong": ["three", "plausible", "wrong answers"], "source": "url" } ],  // exactly 30
  "facts": [ { "fact": "...", "source": "url" } ],      // every fact used above, for audit (not shown)
  "unverified": [ "anything you could not confirm" ]
}

BLOCK types (pick what fits the content; never invent numbers):
- { "type": "scale",   "title": "Sweetness · sugar per litre", "rows": [ { "name": "Brut", "value": "under 12 g", "pct": 0.24 } ], "note": "one line" }   // bars, pct 0-1
- { "type": "pyramid", "title": "Four levels, top to bottom", "rows": [ { "name": "Grand Cru", "note": "short" } ] }     // 3-5 rows, top first
- { "type": "tiles",   "title": "On the label: who made it", "dark": true, "items": [ { "name": "NM", "text": "short" } ] }  // 2-4 tiles
- { "type": "compare", "items": [ { "label": "LEFT BANK", "title": "Cabernet on gravel", "text": "lines\nseparated by\nnewlines" }, { ... } ] }  // exactly 2
- { "type": "list",    "title": "The five First Growths", "rows": [ { "name": "Château Latour", "meta": "Pauillac" } ], "note": "one line" }  // 3-8 rows
- { "type": "steps",   "title": "West to east, along the river", "items": [ { "name": "Pays Nantais", "text": "Muscadet", "meta": "Melon" } ] }  // 3-5
- { "type": "stat",    "number": "51", "title": "Grands Crus", "text": "one or two sentences" }
- { "type": "names",   "items": [ { "title": "CHABLIS GRAND CRU · 7", "text": "comma, separated, names" } ] }  // 1-2 dark cards

Chapters (Court of Master Sommeliers Introductory outline order):
1 How wine is made · 2 Tasting like a sommelier · 3 Wine law and labels · 4 France (done) · 5 Italy · 6 Germany and Austria ·
7 Spain and Portugal · 8 North America · 9 The Southern Hemisphere · 10 Sparkling, fortified and sweet · 11 Beer, sake and spirits · 12 On the floor
