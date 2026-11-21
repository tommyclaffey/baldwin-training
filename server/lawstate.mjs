// Michigan law, labelled for other states (Nov 21, launch checklist step 5; Tommy: "label the Michigan law sources for other
// states").
//
// The lessons that teach liquor law (Cocktail Program Level 4 "Responsible service and the law", the Beer Program's sample,
// staff-tasting, supplier and distribution rules…) were written from Michigan's Liquor Control Code, because The Baldwin is in
// Michigan. Every other company reads the same lessons, so a section built on Michigan law carries a note saying so:
//
//   state unknown          "Example: Michigan law. Your state's rules may differ; check with your manager."
//   state known, not MI    "Example: Michigan law. <Company> is in Ohio, where the rules may differ; check with your manager."
//   Michigan               nothing changes (The Baldwin and its demo copies read the lessons exactly as before)
//
// We never write another state's law: the note only says the example is Michigan's.
//
// A company's state lives on companies.state (a super admin sets it in Super Admin → Companies). Baldwin Restaurant Group
// (company 1) is Michigan, and its demo copies show The Baldwin, so they read Michigan too.
//
// Which sections count: a section whose source cites the Michigan Liquor Control Code (MCL 436.x) or the Michigan Liquor
// Control Commission, or a lesson/section marked "law": "Michigan". Found from the sources, so a lesson added later is covered.
import { BRG_NAME } from './variant.mjs';

export const LAW_STATE = 'Michigan';
export const STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts',
  'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee',
  'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];
/** "ohio" → "Ohio"; anything that isn't a US state (or DC) → null. */
export const stateName = (x) => STATES.find((s) => s.toLowerCase() === String(x || '').trim().toLowerCase()) || null;

/** companies.state (unnumbered, like program_acks: can't collide with a migration added on another branch). */
export function initLawState(db) {
  const cols = db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name);
  if (!cols.includes('state')) {
    db.exec('ALTER TABLE companies ADD COLUMN state TEXT');
    // Baldwin Restaurant Group is in Michigan (the lessons' law is its own)
    db.prepare("UPDATE companies SET state = ? WHERE id = 1 AND name = ?").run(LAW_STATE, BRG_NAME);
  }
  stateCache.clear();
}

const stateCache = new Map();
/** A company's state: its own, or (a demo copy of The Baldwin) Baldwin Restaurant Group's. null when nobody has set it. */
export function companyState(db, companyId) {
  const k = Number(companyId);
  if (!k) return null;
  if (stateCache.has(k)) return stateCache.get(k);
  let out = null;
  try {
    const co = db.prepare('SELECT * FROM companies WHERE id = ?').get(k);
    if (co?.state) out = stateName(co.state);
    else if (co?.demo && (co.brand || 'baldwin') === 'baldwin' && co.name === BRG_NAME) out = stateName(db.prepare('SELECT state FROM companies WHERE id = 1').get()?.state);
  } catch { out = null; } // no state column yet (a database the server hasn't opened)
  if (stateCache.size > 500) stateCache.clear();
  stateCache.set(k, out);
  return out;
}
/** After a super admin changes a company's state. */
export const forgetState = () => stateCache.clear();

const LAW = /\bMCL\s*436|Michigan Liquor Control (Code|Commission)/i;
/** Is this lesson section written from Michigan law? */
export const isMichiganLaw = (ch, sec) => sec?.law === LAW_STATE || ch?.law === LAW_STATE || LAW.test(sec?.source || '');

/** The note a section of Michigan law carries for this company, or null (a Michigan company reads it as written). */
export function lawNote(state, company) {
  if (state === LAW_STATE) return null;
  const where = state && company ? `${company} is in ${state}, where the rules may differ` : state ? `Your restaurant is in ${state}, where the rules may differ` : 'Your state’s rules may differ';
  return { head: 'EXAMPLE · MICHIGAN LAW', text: `Example: Michigan law. ${where}; check with your manager.` };
}
