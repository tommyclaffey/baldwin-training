// Puts real progress into the designed Quizzes page rows and the sidebar "Your training" card.
import type { FNode } from '../components/FigmaNode';
import { QUIZZES, nextQuiz, passFor, statusOf, type Status, useQuiz } from './store';

type State = ReturnType<typeof useQuiz>;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const texts = (n: FNode, out: FNode[] = []) => { if (n.t === 'T') out.push(n); (n.c || []).forEach((c) => texts(c, out)); return out; };
function walk(n: FNode, fn: (n: FNode) => void) { fn(n); (n.c || []).forEach((c) => walk(c, fn)); }
const setText = (n: FNode | undefined, s: string) => { if (n) { n.s = s; n.n = s; delete n.segs; } };

const PILL: Record<Status, [string, string]> = {
  signed: ['Signed off', 'green'], passed: ['Passed', 'green'], retry: ['Try again', 'copper'], progress: ['In progress', 'copper'], todo: ['To do', 'grey'],
};
const BUTTON: Record<Status, [string, 'ghost' | 'dark']> = {
  signed: ['Retake', 'ghost'], passed: ['Retake', 'ghost'], retry: ['Retake', 'dark'], progress: ['Continue', 'dark'], todo: ['Start', 'dark'],
};

/** Quizzes page: each sign-off row shows this person's real status and links to its quiz. */
export function quizPage(main: FNode, s: State): FNode {
  const m = clone(main);
  // Pill and button looks, taken from the design's own rows.
  const proto: Record<string, FNode> = {};
  walk(m, (n) => {
    if (n.n === 'Pill · Signed off') proto.green ||= n;
    if (n.n === 'Pill · In progress') proto.copper ||= n;
    if (n.n?.startsWith('Pill · To do')) proto.grey ||= n;
    if (n.n === 'Button · Retake') proto.ghost ||= n;
    if (n.n === 'Button · Start' || n.n === 'Button · Continue') proto.dark ||= n;
  });
  // The sign-off list: one row per built-in or team quiz, laid out across the two drawn columns.
  let protoRow: FNode | undefined;
  const columns: FNode[] = [];
  walk(m, (n) => { if (n.n === 'Column' && n.c?.some((c) => c.n?.startsWith('Sign-off · '))) { columns.push(n); protoRow ||= n.c.find((c) => c.n?.startsWith('Sign-off · ')); } });
  if (protoRow && columns.length) {
    const rows = QUIZZES.map((quiz) => {
      const row = clone(protoRow!);
      row.n = 'Sign-off · ' + quiz.title;
      const st = statusOf(s, quiz.id);
      const rec = s.quizzes[quiz.id];
      const retake = st === 'signed' || st === 'passed' || st === 'retry';
      row.to = `/quizzes?quiz=${encodeURIComponent(quiz.id)}${retake ? '&retake=1' : ''}`;
      const img = row.c?.find((c) => c.n?.startsWith('IMG/'));
      if (img) img.f = quiz.photo ? [{ img: quiz.photo, m: 'FILL' }] : [{ c: '#E7DECF' }];
      const copy = row.c?.find((c) => c.n === 'Copy');
      if (copy) { copy.sh = 'L'; setText(copy.c?.[0], quiz.title + (quiz.kind === 'team' ? ' · team quiz' : '')); }
      const sub = copy?.c?.[1];
      if (sub) {
        const score = rec?.best !== undefined ? `Score ${rec.best}/${rec.total}` : '';
        const line = st === 'signed' ? score
          : st === 'passed' ? `${score} · a manager signs off next`
          : st === 'retry' ? `${score} · ${passFor(rec?.total || quiz.count)} to pass`
          : st === 'progress' ? `${rec!.current!.answers.length} of ${rec!.current!.items.length} answered`
          : `${quiz.count} questions`;
        setText(sub, line);
        sub.f = [{ c: '#5E574F' }];
      }
      const [pillText, pillKind] = PILL[st];
      const [btnText, btnKind] = BUTTON[st];
      row.c = row.c?.map((c) => {
        if (c.n?.startsWith('Pill · ') && proto[pillKind]) { const p = clone(proto[pillKind]); p.n = 'Pill · ' + pillText; setText(texts(p)[0], pillText); return p; }
        if (c.n?.startsWith('Button · ') && proto[btnKind]) { const b = clone(proto[btnKind]); b.n = 'Button · ' + btnText; setText(texts(b)[0], btnText); return b; }
        return c;
      });
      return row;
    });
    // Nov 5, Tommy: "no som quizzes in the sign off sections". The list is sectioned like the quiz builder: a heading
    // per group (Food, Bar, Know It Cold, Sommelier Level 1, Sommelier Level 2, Team Quizzes), each split across the
    // two drawn columns.
    let pair: FNode | undefined, holder: FNode | undefined;
    walk(m, (n) => { if (!pair && n.c?.includes(columns[0])) pair = n; });
    if (pair) walk(m, (n) => { if (!holder && n.c?.includes(pair!)) holder = n; });
    const groups = [...new Set(QUIZZES.map((q) => q.group || 'More'))];
    if (pair && holder && groups.length > 1) {
      const blocks = groups.flatMap((g) => {
        const mine = rows.filter((_, i) => (QUIZZES[i].group || 'More') === g);
        const p = clone(pair!); const cols = (p.c || []).filter((c) => c.n === 'Column');
        const half = Math.ceil(mine.length / cols.length);
        cols.forEach((col, i) => { col.c = mine.slice(i * half, (i + 1) * half); col.h = 0; });
        p.c = (p.c || []).filter((c) => c.n !== 'Column' || (c.c || []).length); // no empty card beside a one-quiz group
        p.n = 'Columns · ' + g;
        const head: FNode = { t: 'T', n: 'Group · ' + g, s: g.toUpperCase(), ff: 'Archivo', fs: 'Bold', z: 12, ls: '12%', f: [{ c: '#8A5A3A' }], ar: 'W', sh: 'H', sv: 'H' } as FNode;
        return [head, p];
      });
      holder.c = holder.c!.flatMap((c) => (c === pair ? blocks : [c]));
    } else {
      const half = Math.ceil(rows.length / columns.length);
      columns.forEach((col, i) => { col.c = rows.slice(i * half, (i + 1) * half); col.h = 0; });
    }
  }
  return m;
}

/** Sidebar card: real count, bar and the quiz to continue. */
export function trainingCard(nodes: FNode[], s: State): FNode[] {
  const out = clone(nodes);
  const passed = QUIZZES.filter((q) => ['signed', 'passed'].includes(statusOf(s, q.id))).length;
  const next = nextQuiz(s);
  for (const root of out) walk(root, (n) => {
    if (n.n !== 'Your Training' || !n.c) return;
    for (const c of n.c) {
      if (c.t === 'T' && /signed off|passed/.test(c.s || '')) setText(c, `${passed} of ${QUIZZES.length} quizzes passed`);
      if (c.n === 'Progress' && c.c?.[0]) c.c[0].w = QUIZZES.length ? Math.round((c.w * passed) / QUIZZES.length) : 0;
      if (c.n === 'Button · Continue') {
        c.to = next ? `/quizzes?quiz=${encodeURIComponent(next.id)}` : '/quizzes';
        const t = texts(c)[0];
        setText(t, next ? (statusOf(s, next.id) === 'progress' ? 'Continue Quiz' : 'Start Next Quiz') : 'See Your Quizzes');
      }
    }
  });
  return out;
}
