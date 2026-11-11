// Which version of a program's text a request reads (Nov 11, the Hospitality Program).
//
// The Hospitality Program is Baldwin Restaurant Group's own training: it names BRG and its water brands. BRG's companies
// read that version; every other company reads a generic one with the same lessons, cards and certificate, written as its
// own content set (content/hospitality-generic), with "{restaurant}" filled in with the store's name.
//
// BRG = company 1 (Baldwin Restaurant Group: The Baldwin, J.Baldwin's, Testa Barra), plus The Baldwin's demo copies
// (companies.demo = 1, named "Baldwin Restaurant Group"). A company whose brand is 'mise' (the Wrenfield demo) never is.
//
// The answer is kept per request (AsyncLocalStorage), so every part of the server that reads lessons (pages, search,
// quizzes, paths, certificates) sees the same version without passing it around.
import { AsyncLocalStorage } from 'node:async_hooks';

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
  als.enterWith({ brg: storeRow ? isBrgCompany(db, storeRow.company_id) : true, restaurant: storeRow?.name || null });
}

/** Run `fn` as a given company would see it (tests, scripts). */
export const asVariant = (v, fn) => als.run({ brg: true, restaurant: null, ...v }, fn);

/** This request's version: { brg, restaurant }. Outside a request: BRG. */
export const variant = () => als.getStore() || { brg: true, restaurant: null };
