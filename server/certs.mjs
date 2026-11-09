// Certificates (Nov 8, Tommy: "Let's do the cert"). Figma: 09 · Proposals → 22 · Certificates (468:45).
// A level is earned when its final is passed and, where the level has one, its practical is signed off. Retaking the final
// never takes a certificate away: the first passing attempt and the best passing score stay.
import { LEVELS, programDef, chaptersForLevel, countWord } from './manual.mjs';
import { passFor } from './quizgen.mjs';

/** Every certificate this person has earned, newest first. */
export function certificatesFor(db, user, store, storeRow) {
  const out = [];
  for (const L of LEVELS) {
    if (!chaptersForLevel(L).length) continue;
    const P = programDef(L.program);
    const passes = db.prepare('SELECT score, total, at FROM quiz_attempts WHERE user_id = ? AND quiz = ? ORDER BY at').all(user.id, 't:' + L.final).filter((r) => r.score >= passFor(r.total));
    if (!passes.length) continue;
    const best = passes.reduce((a, r) => (r.score / r.total > a.score / a.total ? r : a), passes[0]);
    let practical = null;
    if (L.practical) {
      const s = db.prepare('SELECT s.at, u.name by_name FROM signoffs s LEFT JOIN users u ON u.id = s.by_user WHERE s.device = ? AND s.quiz = ? AND s.store_id = ?').get('u' + user.id, L.practical, store);
      if (!s) continue;
      practical = { at: s.at, by: s.by_name || null };
    }
    const earned = [passes[0].at, practical?.at].filter(Boolean).sort().pop();
    out.push({
      key: L.file, isA: L.isA !== false, program: L.program, programName: P.name, programSlug: L.slug, level: L.level, levelWord: countWord(L.level), title: L.title, seal: P.seal,
      name: user.name, final: { pct: Math.round((best.score / best.total) * 100), at: best.at, firstAt: passes[0].at },
      practical, number: `${L.prefix}-${String(user.id).padStart(4, '0')}`, earnedAt: earned,
      store: storeRow?.name || null, logo: storeRow?.book_ready ? '/img/logo-white.png' : null, fine: P.fine,
    });
  }
  return out.sort((a, b) => String(b.earnedAt).localeCompare(String(a.earnedAt)));
}
