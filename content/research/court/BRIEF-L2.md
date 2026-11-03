# Brief: write Level 2 (Certified Sommelier) Study Guide chapters (Nov 2, 2026)

Tommy: "for the som training use these resources to structure everything and content for the classes"
(https://www.mastersommeliers.org/resources/resource-library/).

Level 2 has 9 chapters in 3 parts (approved design: "Part 1 Tasting · 3 lessons · Grid Trainer", "Part 2 Theory · 3 lessons ·
90 cards", "Part 3 Service · 3 lessons · 4 Court videos · Mock Service"). Write them as JSON files in
`~/Coding/baldwin-training/content/manual-l2/<slug>.json` (create the folder), in the SAME format as Level 1
(`content/manual/SCHEMA.md`, including the full `v3` object), plus top-level `"level": 2`, `"part": 1|2|3`, and a `"court"` object:
`{ "outcome": "the Court's Certified learning outcome(s) quoted exactly", "outcomeSource": "<url>", "coverage": [ { "topic", "guide", "where" } ] }`.
Look at `content/manual/france.json` for a finished Level 1 example.

The 9 chapters:
- Part 1 · Tasting: 1 `certified-tasting-grid` "The tasting grid, line by line" · 2 `certified-white-wines` "The white wines on the exam" ·
  3 `certified-red-wines` "The red wines on the exam"
- Part 2 · Theory: 4 `certified-old-world` "The Old World, in depth" · 5 `certified-new-world` "The New World, in depth" ·
  6 `certified-beyond-still-wine` "Sparkling, sweet, fortified, beer, sake, spirits and cocktails"
- Part 3 · Service: 7 `certified-service-standards` "Hospitality and service standards" · 8 `certified-at-the-table`
  "Still, sparkling and decanting at the exam" · 9 `certified-business` "The business of the sommelier"

Court documents (text in `content/research/court/`): `Certified-Sommelier-Exam-Guide-What-to-Expect.txt`,
`Certified-Sommelier-Exam-Syllabus.txt`, `Certified-Sommelier-Level-Wines.txt` (the examinable grapes and regions),
`CMS-A-Certified-Sommelier-Deductive-Tasting-Grid.txt`, `2024-Deductive-Tasting-Initial-and-Final-Conclusions-KL.txt`,
`23-What-Makes-A-Wine-Classic-Checklist-11-2022.txt`, `CMS-Hospitality-Service-Standards.txt`, `CMSProfessionalSommDemeanor.txt`,
`Certified_Sommelier_Example_Feedback_Report_2026322.txt`, `CMS-A-Cert-Advanced-Sommelier-Theory-Exam-Level-Comparison-Example-Questions.txt`,
and the Curriculum Guide (`curriculum-guide-layout.txt`, Certified column = Level 2 theory; PDF
https://www.mastersommeliers.org/wp-content/uploads/2023/12/Introductory-Sommelier-Course-and-Certified-Somm-Theory-Exam-Curriculum-Guide.pdf).
Original PDFs are at https://www.mastersommeliers.org/resources/resource-library/ (cite the PDF URL as the source).

Rules:
- Certified depth: build on Level 1 (don't re-teach basics; say "From Level 1: …" in one line where helpful).
- Each chapter: 5-9 sections, each with v3 keyPoints (3-5), a full `read`, 3 `check` cards, and classic fields; 30 cards per chapter.
- Our own plain words. Don't copy long passages or the Court's example/practice questions. Short terms and the grid's line names are fine.
- Every sentence backed by a fact with a source URL (Court PDFs, or official region bodies, Wine Folly for grape profiles). Never guess;
  unconfirmed → `unverified`.
- Videos under the SCHEMA video rules (Court of Master Sommeliers @courtofmastersommeliers first, then Wine Folly or official
  bodies; verify each with YouTube oEmbed; never guess an ID). The Court's service videos: 9R3JBuXcNjQ (open a bottle),
  XFiWNb9GMNE (sparkling), uOhVibnoThs (decant), XlPAFfudZA4 (service exam advice).
- `book` links only to app pages listed in `content/manual/APP-PAGES.txt`.
- Validate the JSON. Edit only your own files. No git, no npm.

Report back per chapter: sections, cards, videos, and what you couldn't source.
