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

## v3 · video first + reading flow (Nov 1, 2026)

Tommy: "the written stuff seems like it's not very easy to read. The flow doesn't feel good." The v3 lesson is
watch → swipe the key points → read → answer 3 cards. Add a top-level `"v3"` object. **Do not change or remove any
existing key**: the live app still reads them until v3 ships.

"v3": {
  "video": VIDEO,                         // the chapter's intro video (shown on the Level 1 lesson grid), or null
  "sections": [                           // same order and same "name" as the top-level "sections"
    {
      "name": "Loire",
      "video": VIDEO | null,              // a video about THIS section; null if none is good enough
      "keyPoints": [ { "big": "MUSCADET", "line": "is Melon B, often aged on its yeast (“sur lie”)." } ],  // 3-5 cards; big = 1-3 words, CAPS; line ≤ 70 chars and finishes the sentence
      "read": {
        "bigIdea": "The Loire is France’s white-wine river.",          // one sentence, ≤ 60 characters
        "where": "2-4 short sentences. **Bold** the words that are on the exam.",
        "stopsTitle": "Four stops, west to east",                       // optional script heading for the list below
        "stops": [ { "name": "Pays Nantais", "note": "by the Atlantic", "text": "1-3 sentences with **bold** terms." } ],  // 2-5, in teaching order
        "visual": 1,                       // optional: index into this section's "visuals" to show after the stops
        "visualIntro": "Two words tell you how sweet a Chenin is:",     // optional one line before the visual
        "mixup": "**Pouilly-Fumé** is Loire Sauvignon Blanc. **Pouilly-Fuissé** is Burgundy Chardonnay.",  // optional
        "sayIt": "A Loire white. Crisp and mineral."                    // optional; a line a server could say at the table
      },
      "check": [12, 13, 14]               // exactly 3 indexes into "cards" that test this section (add cards if needed)
    }
  ]
}

VIDEO = { "youtubeId": "F0jDcA_Ujcc", "title": "Sauvignon Blanc (Everything you need to know)", "by": "Wine Folly", "length": "5:04" }
- Only these channels: **Wine Folly**, **Court of Master Sommeliers, Americas** (@courtofmastersommeliers), or a wine region's
  own official body (e.g. Wines of Germany, Champagne's CIVC). Check every video: YouTube oEmbed must return it (title and
  author_name), and the length comes from the watch page. Never guess an ID.

Writing rules for "read":
- One column, story order: the big idea → where/what → the stops (one wine, grape or step at a time) → what's on the label →
  don't mix up → say it at the table.
- Short paragraphs (2-3 sentences). Plain words a server would use. US spelling (color, liter), French/Italian terms as written.
- Every sentence must be backed by a fact in "facts". If a new fact is needed, add it to "facts" with its source URL first.
- "sayIt" lines are ours (not sourced); keep them modest and true.
