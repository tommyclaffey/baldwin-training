// Which version of a program's text a request reads (Nov 11, the Hospitality Program).
//
// The Hospitality Program has a version every company reads (content/hospitality-generic), with "{restaurant}" filled in
// with the store's name. Baldwin Restaurant Group wrote its own (it names BRG and its water brands); since Nov 16 that
// version is BRG's account content (DATA_DIR/accounts/1/programs/hospitality, server/account.mjs), not part of this repo.
// A request reads its account's own version when the account has one (`account` below), the shared one otherwise.
//
// BRG = company 1 (Baldwin Restaurant Group: The Baldwin, J.Baldwin's, Testa Barra), plus The Baldwin's demo copies
// (companies.demo = 1, named "Baldwin Restaurant Group"). A company whose brand is 'mise' (the Fig & Fire demo) never is.
//
// The answer is kept per request (AsyncLocalStorage), so every part of the server that reads lessons (pages, search,
// quizzes, paths, certificates) sees the same version without passing it around.
import { AsyncLocalStorage } from 'node:async_hooks';
import { accountFor } from './account.mjs';
import { companyState, LAW_STATE } from './lawstate.mjs';

const als = new AsyncLocalStorage();
export const BRG_NAME = 'Baldwin Restaurant Group';

/** Is this company one of Baldwin Restaurant Group's (or The Baldwin's demo)? */
export function isBrgCompany(db, companyId) {
  if (!companyId) return true; // no company yet (setup, tests that read files directly): the book's own default
  if (Number(companyId) === 1) return true;
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!row) return false;
  if (row.brand && row.brand !== 'baldwin') return false;
  return !!row.demo && row.name === BRG_NAME;
}

/** Called once at the start of each API request: this request reads its company's version. */
export function enterStore(db, storeRow) {
  // state (Nov 21): the company's US state, for the note on lessons written from Michigan law (server/lawstate.mjs)
  als.enterWith({ brg: storeRow ? isBrgCompany(db, storeRow.company_id) : true, restaurant: storeRow?.name || null, account: accountOf(storeRow),
    state: storeRow ? companyState(db, storeRow.company_id) : LAW_STATE });
}
/** The account folder whose program text a store reads (server/account.mjs), or null. */
export const accountOf = (storeRow) => (storeRow?.company_id ? accountFor(storeRow.company_id)?.account ?? null : null);

/** Run `fn` as a given company would see it (tests, scripts). */
export const asVariant = (v, fn) => als.run({ brg: true, restaurant: null, account: null, state: LAW_STATE, ...v }, fn);

/** This request's version: { brg, restaurant, account, state }. Outside a request: BRG's group (Michigan), no account folder. */
export const variant = () => als.getStore() || { brg: true, restaurant: null, account: null, state: LAW_STATE };
/** A cache key for this request's version (pages, indexes and quiz pools differ by it). */
export const variantKey = () => { const v = variant(); return `${v.brg ? 1 : 0}:${v.account ?? ''}:${v.restaurant ?? ''}`; };
