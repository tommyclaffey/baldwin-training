# Brief: write Level 3 (Advanced Prep) Sommelier lessons (Nov 19, 2026)

Tommy: "can we start working on level three and possibly level 4 of the wine program."

Level 3 of the Sommelier Program prepares people for the Court of Master Sommeliers' **Advanced Sommelier** exam.
It sits on top of our Level 1 (`content/manual/`, Introductory) and Level 2 (`content/manual-l2/`, Certified).
Write the lessons as JSON files in `~/Coding/bt-somm34/content/manual-l3/<slug>.json` (create the folder if missing).

## The Court's own material (read these first)
- `content/research/somm-l3.json`: the checked Court facts (exam format, eligibility, pass marks, topics), with URLs.
- Court PDFs as text, in `content/research/court/` (cite the PDF URL from `somm-l3.json`, never the .txt):
  - `CMS-A-WHAT-TO-EXPECT-at-the-Advanced-Sommelier-Theory-Exam_0.txt`: format, topics (France, Italy, Germany… Morocco),
    and the "Areas of Study" (location, climate, grapes, vineyard, winery, soils, laws, styles, producers, vintages, service).
  - `CMS-A-WHAT-TO-EXPECT-Advanced-Sommelier-Expected-Skill-Set.txt`: the skill set (quote lines from it for `court.outcome`).
  - `CMS-A-WHAT-TO-EXPECT-at-the-Advanced-Sommelier-Practical-Exam.txt`: Business of the Sommelier + Hospitality & Service.
  - `CMS-A-WHAT-TO-EXPECT-at-the-Advanced-Sommelier-Tasting-Exam_1.txt`, `2024-CMS-A-Advanced-and-Master-Sommelier-Deductive-Tasting-Format.txt`,
    `CMS-A-Advanced-Sommelier-Level-Wine.txt` (the core grapes and regions), `23-What-Makes-A-Wine-Classic-Checklist-11-2022.txt`.
  - `2025-ADV-MS-HS-Standards-and-Guidlines-FINAL.txt`: the Advanced and Master service standards (2025).
  - `CMS-A-Theory-Answer-Guidelines-082925.txt`, `24-ADV-Theory-Results-Feedback-Report-Example.txt`,
    `24-ADV-Practical-Tasting-Results-Feedback-Report-Example.txt`.
  - The Court's web page: `certification_certification-levels_advanced-sommelier-course-and-examination.txt`
    (URL https://www.mastersommeliers.org/certification/certification-levels/advanced-sommelier-course-and-examination/).
  - **Do not copy** the Court's illustrative/example questions (`Upper-Level-2023-Theory-Illustrative-Examples.txt`,
    `CMS-A-Cert-Advanced-...-Example-Questions.txt`, `26-Upper-Level-HS-Illustrative-Examples.txt`). Read them only to judge depth.
- For regions, laws and products: the official bodies the Court's theory guide itself lists (champagne.fr, federdoc.com,
  germanwines.de, riojawine.com, winesofportugal.com, wosa.co.za, nzwine.com, wineaustralia.com, winesofchile.org,
  winesofargentina.org, ttb.gov, oregonwine.org, washingtonwine.org, winesofcanada.ca, austrianwine.com, winesofgreece.org,
  japansake.or.jp / nrib.go.jp for sake), plus other official regional boards, government law texts (eCFR, EUR-Lex), and
  Wine Folly for grape profiles. Fetch and read the page; record the URL. Never state a number you didn't read on a source.

## Format (same as Level 2, plus program fields)
Follow `content/manual/SCHEMA.md` exactly, including the full `v3` object, and look at `content/manual-l2/certified-business.json`
and `content/manual-l2/certified-old-world.json` as finished examples. Differences for Level 3:
- Top-level `"program": "somm"`, `"programLevel": 3`, `"part": 1|2|3`, `"number"` (1–9, the order below). Do **not** add `"level"`.
- Each top-level section gets `"source"`: one short line naming that section's sources in words
  (e.g. "Court of Master Sommeliers, Advanced Theory Exam guide; Wines of Germany"). No `"book"` field (it draws a bar button).
- `"court"`: `{ "outcome": "<one or two lines quoted word for word from a Court PDF or page, for this chapter>",
  "outcomeSource": "<that PDF/page URL>", "coverage": [ { "topic", "guide" (≤ 20 words, ours), "where": "<exact section name>" } ] }`.
  Cover every Court topic/subtopic that belongs to the chapter (e.g. France's ten regions). Use `"where": "<section A>; <section B>"`
  for a row covered in two sections.
- Every section: 1–2 `lines`, 3–5 `know`, 1–2 `visuals` (SCHEMA block types; never invent numbers), and in `v3`: 3–5 `keyPoints`,
  a full `read` (bigIdea, where, stopsTitle, **2–5 stops**, visual index if useful, **mixup is required**, sayIt optional),
  and `check`: exactly 3 card indexes. `v3.video` and every `v3.sections[].video`: `null` (a separate pass adds checked videos).
- Cards: **3 per section, plus up to 2 more per section if useful** (so a chapter of 5 sections has 15–25). Each card: `q`, `answer`,
  exactly 3 `wrong`, `source` URL. Wrong answers must be the same kind of thing as the answer (a grape for a grape, a region for a
  region, a number for a number), plausible, clearly wrong, never the answer reworded, never "all of the above"/"none of the above"
  or jokes. Each `check` card belongs to its section.
- `facts`: every fact any sentence relies on, with its URL. `unverified`: anything sources disagree on or you couldn't confirm;
  it must not be stated as fact anywhere on the page. `sources`: one sentence naming the bodies used and "Checked Nov 19, 2026."
- `mixups`: 3–4 pairs. `intro` optional (the "Start here" band).

## Writing rules
- Advanced depth: build on Levels 1 and 2. Don't re-teach basics; a single "From Level 2: …" line is fine.
- Our own plain words: short sentences, a server or sommelier's vocabulary, US spelling, French/Italian/German terms as written.
  **Never copy the Court's text** beyond the quoted `court.outcome` and short terms (grid line names, topic names).
- Facts about the Court (exam parts, pass marks, eligibility, timing) only as `somm-l3.json` / the Court pages state them. No prices,
  dates, pass rates or numbers of Master Sommeliers.
- This is a shared library for every restaurant group: nothing about any one restaurant ("our list", "your guests" are fine; no
  restaurant, person, city or state names as if they were ours). Business examples use made-up round numbers labelled as examples.
- **Bold** only exam words in `read`. `bigIdea` ≤ 60 characters. Key point `big` 1–3 words CAPS, `line` ≤ 70 characters.

## The nine lessons (adjust section names to the Court's real topics; 4–6 sections each)
Part 1 · Theory
1. `advanced-the-exam` "What Advanced asks of you": the skill set and roles · the course and the SKA · the three sections and the
   60% rule in one year · how the theory exam works (Pearson VUE, question types) · a study system (breadth vs depth, the two questions).
2. `advanced-vine-and-winery` "Cause and effect: vineyard and winery": the vine cycle and training systems · organic and biodynamic ·
   fermentation choices (whole cluster, carbonic, MLF, skin contact) · oak (French, American, Eastern European; new vs used) · how it shows in the glass.
3. `advanced-france` "France, region by region": Champagne · Burgundy · Bordeaux · Loire and Alsace · Rhône · the South and the
   mountains (Provence, Languedoc-Roussillon, Southwest, Jura and Savoie).
4. `advanced-europe` "Europe beyond France": Italy (twenty regions, DOCG logic, Piedmont/Tuscany/Veneto depth) · Germany (13 regions,
   Prädikat, VDP) · Spain (DO, DOCa, Vino de Pago) and Portugal · Austria, Greece, Eastern Europe and the Caucasus · England, Switzerland, the Middle East, China and India.
5. `advanced-new-world` "The New World in depth": United States (AVAs and TTB rules; California, Oregon, Washington, New York, other states) ·
   Canada and Mexico · Argentina, Chile and Uruguay · Australia and New Zealand · South Africa (and Morocco if sourced).
6. `advanced-beyond-wine` "Sparkling, fortified, sweet, beer, sake and spirits": sparkling methods and Champagne law · Sherry, Port,
   Madeira, Marsala, VDN and VDL · sweet wines and aromatized wines · beer · sake (classification, polishing minimums) · spirits, aging laws, aperitifs and digestifs.

Part 2 · Tasting
7. `advanced-deductive-tasting` "The Advanced tasting, six wines in 25 minutes": the grid line by line (sight, nose, structure, palate) ·
   initial and final conclusions · the core wines (whites, reds; what "classic" means) · exam-day rules (one answer, describe not name).

Part 3 · Practical
8. `advanced-service` "Hospitality and service at Advanced": hospitality, price and problem resolution · general standards (order, glassware,
   presentation, pour) · sparkling and decanting at Advanced · beer, sake, aperitifs, digestifs and cocktails · pairing and selling.
9. `advanced-business` "The business of the sommelier": costing wine, cocktails and flights · inventory sheets and audits · the list:
   content, design and correcting mistakes · purchasing, cellar and equipment · training the staff.

## Before you finish
- `node -e 'JSON.parse(require("fs").readFileSync("<file>"))'` on each file; every `check` index exists; `v3.sections[].name` equals
  the top-level section names in the same order; every card has 3 distinct wrongs that don't include the answer.
- Edit only your own chapter files. No git, no npm, no other files.
- Report back per chapter: sections, cards, sources used, unverified items.
