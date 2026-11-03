# Brief: align a Level 1 Study Guide chapter with the Court's own course (Nov 2, 2026)

Tommy: "for the som training use these resources to structure everything and content for the classes"
(https://www.mastersommeliers.org/resources/resource-library/).

Our 12 Level 1 chapters (`~/Coding/baldwin-training/content/manual/<slug>.json`, format in `content/manual/SCHEMA.md`, incl. the
v3 section) already follow the Court's 12-section Introductory course outline. Your job: make each of your chapters cover what
the Court's **Curriculum Guide, Introductory column** lists, and say what the Court expects.

Court documents (text already extracted, in this folder `content/research/court/`):
- `curriculum-guide-layout.txt`: the Curriculum Guide page by page, with columns kept (topic | Introductory | Certified). Search for
  "Subject N ame" / your subject. Columns sometimes bleed; if unclear, read the PDF itself:
  https://www.mastersommeliers.org/wp-content/uploads/2023/12/Introductory-Sommelier-Course-and-Certified-Somm-Theory-Exam-Curriculum-Guide.pdf
- `curriculum-guide.json`: the same split into subjects, outcomes and rows (rough).
- `Introductory-Sommelier-Course-Guide-What-to-Expect.txt`: the course outline (Section 1-12 and their subtopics).
- `Grape-Variety-Profiles-Introductory-Level.txt`, `Introductory-Sommelier-Course-Syllabus.txt`.

For EACH of your chapters:
1. Add a top-level `"court"` object:
   `{ "section": <Court outline section number>, "outline": ["the outline's subtopics for this section, as the Court lists them"],
      "outcome": "the Court's Introductory learning outcome(s) for the matching subject(s), quoted exactly, joined if several",
      "outcomeSource": "<curriculum guide PDF URL>",
      "coverage": [ { "topic": "topic row name", "guide": "what the Introductory column asks, in ≤ 20 words, your words",
                      "where": "<our section name> or 'added: <section name>'" } ] }`
   Cover every Introductory-column row of the matching subjects. Certified-only rows are out of scope for Level 1.
2. Fill every gap in the v3 lessons AND the classic fields (both are read by the app):
   - Small gaps: add to the right existing section (v3 `read.stops`, `read.where`, `keyPoints`, or a `visuals` block; and the classic
     `know`/`lines`).
   - A missing region/topic the Court lists as its own subtopic (e.g. Italy: Marche and Campania; Chile: Aconcagua and Valle Central;
     Hungary: Tokaji): add a NEW section, in the Court's order, to BOTH top-level `sections` and `v3.sections` (same `name`), with
     3-5 keyPoints, a full `read`, and 3 `check` cards. Keep each chapter to ≤ 10 sections; merge if needed.
   - Write in our own plain words (see SCHEMA writing rules). Never copy long passages from the Court; short terms are fine.
3. Every new sentence needs a fact in `facts` with a source URL. The Curriculum Guide PDF URL is a valid source for anything in its
   Introductory column; prefer adding an official region body too when easy. Don't guess. Put anything unconfirmed in `unverified`.
4. Add cards for the new material (same card format, own wording). Chapters may now hold up to 45 cards. Do NOT copy questions
   from the Court's practice exam.
5. Videos for NEW sections only, under the SCHEMA video rules (Wine Folly, Court of Master Sommeliers, or an official region body;
   verify each with YouTube oEmbed; never guess an ID). null if none fits.
6. Keep every existing key and value unless it's wrong per the Court; if you correct something, note it in your report.
7. Validate the JSON (python3 -c 'import json; json.load(open(...))'). Edit only your chapter files. No git, no npm.

Report back per chapter: the coverage count (covered / added), new sections, anything corrected, anything left unverified.
