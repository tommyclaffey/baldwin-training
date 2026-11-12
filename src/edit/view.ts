// The page as drawn for Edit Mode, or without its editing-only parts. A pure transform of the server's layout.
// Results are kept per node, so a part that didn't change keeps its identity (the column balancing relies on it).
import type { FNode } from '../components/FigmaNode';

const marked = new WeakMap<FNode, boolean>();
const hasEdit = (n: FNode): boolean => {
  let v = marked.get(n);
  if (v === undefined) { v = !!n.eo || !!n.ed || (n.c || []).some(hasEdit); marked.set(n, v); }
  return v;
};
const holds = (n: FNode): boolean => !!n.ed || (n.c || []).some(holds);
const views = { on: new WeakMap<FNode, FNode>(), off: new WeakMap<FNode, FNode>() };

/** Off: the parts only shown while editing (an empty card to type into) go. On: links around a field stop being links,
 *  so a tap on the field types instead of opening another page. Returns the same object when nothing changes. */
export function editView(n: FNode, on: boolean): FNode {
  if (!hasEdit(n)) return n;
  const cache = on ? views.on : views.off;
  const hit = cache.get(n);
  if (hit) return hit;
  let out: FNode;
  if (!on) {
    const c = n.c ? n.c.filter((x) => !x.eo).map((x) => editView(x, false)) : n.c;
    out = c && n.c && (c.length !== n.c.length || c.some((x, i) => x !== n.c![i])) ? { ...n, c } : n;
  } else {
    out = { ...n, c: n.c?.map((x) => editView(x, true)) };
    if (out.to && holds(n)) out.to = undefined;
  }
  cache.set(n, out);
  return out;
}

const adds = new WeakMap<FNode, boolean>();
/** Does the page have a manager's "+ Add" row? */
export function hasAddRow(n: FNode): boolean {
  let v = adds.get(n);
  if (v === undefined) { v = !!(n.meta as { add?: unknown } | undefined)?.add || (n.c || []).some(hasAddRow); adds.set(n, v); }
  return v;
}
