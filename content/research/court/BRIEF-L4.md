# Brief: write Level 4 (Master Prep) Sommelier lessons (Nov 19, 2026)

Level 4 of the Sommelier Program is **by invitation** (like Master of the Bar and Master of Beer): for the person who leads, or will
lead, a restaurant's wine program. It explains the Court of Master Sommeliers' **Master Sommelier Diploma** (only as the Court
states it) and teaches the deepest theory, tasting and service, plus running a wine program: building and costing the list,
buying, cellar management and training the team.

Write the lessons as JSON files in `~/Coding/bt-somm34/content/manual-l4/<slug>.json`.

**Everything in `content/research/court/BRIEF-L3.md` applies** (format, writing rules, card rules, checks), with these changes:
- `"programLevel": 4`; `"part"` may be omitted. Slugs start with `master-`.
- Court facts come from `content/research/somm-l4.json` and the Court texts in `content/research/court/`:
  `certification_certification-levels_master-sommelier-diploma-examination.txt` (the Court's MS page),
  `Master-Sommelier-Diploma-Theory-Exam-Resource-Guide.txt`, `24-MS-Theory-Results-Feedback-Report-Example.txt`,
  `24-MS-PT-Results-Feedback-Report-Example.txt`, `2025-ADV-MS-HS-Standards-and-Guidlines-FINAL.txt`,
  `2024-CMS-A-Advanced-and-Master-Sommelier-Deductive-Tasting-Format.txt`, `CMS-A-Code-Ethics.txt`
  (URL in somm-l4.json), `CMS-A-Candidate-Mentoring-Guidelines.txt`. Don't copy `24-MS-Illustrative-Examples.txt` or
  `25-MS-Theory-Illustrative-Examples.txt` (read only to judge depth). No pass rates, fees, dates, cities or numbers of Master Sommeliers.
- Business and leadership facts come from sources you fetch and read: TTB (three-tier and federal tied-house rules, 27 CFR part 6
  on eCFR), trade guides (BinWise, BevSpot, Toast, SevenFifty, Wine Spectator's Restaurant Awards criteria page), university
  hospitality or extension pages, Wine Folly. State law differs by state: say so and don't name a state's rule as ours.
  All money examples are our own round numbers labelled as examples.
- `court.outcome`: a line quoted word for word from the Court's MS page or an MS/ADV-MS PDF.
- The level's practical (for context, don't write it as a lesson): present a wine list for the restaurant to the owner or GM.

## The six lessons (4 sections each; adjust names to the sources)
1. `master-the-diploma` "The Master Sommelier Diploma": what the title means and who can apply · the three parts and the 75% mark ·
   oral theory (question types, the resource guide's advice) · the practical and the six-wine tasting · the timeline (theory first, the window, forced waits).
2. `master-theory` "Theory at the Master level": wine law around the world (EU PDO/PGI, US AVAs and labeling, Australia GIs, others) ·
   fortified wines: making, storing and handling · distillation, spirits and liqueurs · beer and cider, and keeping every product in condition.
3. `master-tasting` "Tasting at the Master level": the same grid, a higher bar (six wines, 25 minutes, vintages) · calibrating: tasting
   groups and practice · vintage and producer knowledge · what "classic" means and how to taste for it.
4. `master-service` "Service and salesmanship at the Master level": aperitifs and the start of the meal · glassware for every beverage
   and every room · brandies, liqueurs and spirits with portions · questions, complaints and diplomacy (and selling with care).
5. `master-wine-list` "Building and costing the wine list": what a great list does (structure, range, by the glass) · pricing (cost %,
   tiered markups, glass pricing) · buying (three-tier system, distributors and importers, allocations) · the cellar: storage, inventory, par and turnover.
6. `master-leading` "Leading the wine program and the team": training the team (pre-shift, tastings, quizzes) · mentoring toward
   the Court's levels · the numbers each month (COGS, variance, audits) · ethics: suppliers, gifts and the Court's code.

Report back per chapter: sections, cards, sources used, unverified items. Edit only your own files. No git, no npm.
