// The Mise HQ home (Nov 16, Figma 09 · Proposals → 32: desktop 699:880, picker 708:920, phone 714:961 and 716:1016).
// Tommy: "there's nothing for me to interact with. There's no page or anything." A super admin working in Mise Academy (HQ)
// opens Admin on this page: what's waiting on them, the app's health, every company, the Log, new companies and the team.
// Everything here is real data. Where there's nothing to show, the page says so; nothing is made up.
//
//   GET /api/super/home                    the whole page
//   GET /api/super/counts                  the HQ sidebar's numbers (companies, team, deletion requests waiting)
//   GET /api/super/companies/:id/people    Sign In As picker: owners, then managers, then staff by store
//   GET /api/super/errors                  the Error Log (?kind=server|client|seen, ?days=1|7|90, ?q=), read only
// Read only, all of it: the buttons on the page call the routes that already exist (Work Here, Sign In As, New Invite Link,
// the deletion requests), which check the teammate's role themselves. Support sees the page and the picker; `can` hides the
// buttons their role can't use, and the server refuses them anyway (server/miseteam.mjs).
import { teamRole, teamCan, teamCans } from './miseteam.mjs';
import { hqId, HQ_NAME } from './hq.mjs';
import { PLANS, LOOKS, DEFAULT_PLAN, lookOf, lookInfo } from './looks.mjs';
import { demoGroups as demoList } from './demo.mjs';
import { ownedFiles, WAIT_DAYS } from './companydata.mjs';
import { bytesOf, storageCapBytes, volumeFloorBytes, volumeFree } from './files.mjs';
import { latestSnapshot, lastOps, KEEP_DAYS } from './ops.mjs';
import { JOBS } from './paths.mjs';
import { linkOf } from './links.mjs';

const DAY = 864e5;
/** An error that came in this many times in the last 24 hours is "repeating" (Waiting on you). */
export const REPEAT_AT = 3;
/** How fresh each backup line has to be to count as up to date. The pulls are nightly and GitHub can run them late. */
const FRESH_H = { snapshot: 26, backup: 26, files: 26, health: 2 };

const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
const initials = (name) => String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const jobLabel = (jobs) => {
  let list = [];
  try { list = JSON.parse(jobs || '[]'); } catch { /* old rows */ }
  return (Array.isArray(list) ? list : []).map((k) => JOBS.find((j) => j.key === k)?.label).filter(Boolean).join(', ');
};
/** A company person's role as the Log shows it (a teammate's is their Mise team role). */
const ROLE_WORDS = { owner: 'Company owner', manager: 'Company manager', staff: 'Staff' };
const TEAM_WORDS = { owner: 'Owner', manager: 'Manager', support: 'Support' };

/** The Log's words, in the past tense, for the things the Mise team does most. Anything else keeps its own words. */
const DONE = {
  'sign in as': (d) => `Signed in as ${String(d || '').replace(/\s*\((owner|manager|staff)\)$/, '')}`,
  'back from signing in as': (d) => `Back from signing in as ${d || ''}`.trim(),
  'work in company': () => 'Worked here',
  'add company': (d) => `Added a company${/owner invite/.test(d || '') ? ', invited its owner' : ''}`,
  'invite': (d) => `Invited ${String(d || '').split(' → ')[0]}`,
  'plan and look': (d) => `Plan and look: ${String(d || '').split(' · ').slice(1).join(' · ')}`,
  'deletion requested': () => 'Asked to delete company data',
  'cancel deletion request': () => 'Cancelled a deletion request',
  'delete company data': (d) => `Deleted ${String(d || '').split(' · ')[0]}’s data`,
  'joined the Mise team': () => 'Joined the Mise team',
  'invite to the Mise team': (d) => `Invited ${String(d || '').split(' · ')[0]} to the Mise team`,
  'change team role': (d) => `Changed a role: ${d || ''}`,
  'two-step on': () => 'Turned on two-step sign-in',
  'reset password link': (d) => `Made a password reset link for ${String(d || '').split(' (')[0]}`,
  'reset PIN': (d) => (d ? `Reset ${d}’s PIN` : 'Reset a PIN'),
  'rename company': (d) => `Renamed ${d || 'a company'}`,
  'add store': (d) => `Added a store: ${String(d || '').split(' · ').slice(1).join(' · ')}`,
};
function activityOut(r) {
  const action = String(r.action || '').replace(/^super: /, '');
  const words = DONE[action] ? DONE[action](r.detail) : action.charAt(0).toUpperCase() + action.slice(1) + (r.detail ? ` · ${r.detail}` : '');
  const tr = r.team_role || (r.role === 'superadmin' ? teamRole(r) : null);
  return { id: r.id, at: r.at, name: r.name || null, role: tr ? `${TEAM_WORDS[tr]} · Mise team` : (ROLE_WORDS[r.role] || null), what: words, company: r.company || null };
}

export function hqHomeRoutes({ db, fail, sendJson }) {
  // Like Super Admin's own routes: everyone else gets "not found"; two-step first; then the teammate's role.
  const needSuper = (c, action = 'view') => {
    const u = c.user;
    if (!u || u.role !== 'superadmin' || u.impersonator_id) fail(404, 'Not found.');
    if (!u.totp_on) fail(403, 'Turn on two-step sign-in (Your Account) to open the super admin.');
    if (!teamCan(u, action)) fail(403, `Your Mise team role (${TEAM_WORDS[teamRole(u)]}) can’t do that. Ask the owner.`);
    return u;
  };
  const lastSeenOf = db.prepare('SELECT MAX(last_seen_at) at FROM users WHERE company_id = ?');
  const teamRows = () => db.prepare("SELECT * FROM users WHERE role = 'superadmin' AND deleted_at IS NULL ORDER BY super_primary DESC, CASE super_role WHEN 'manager' THEN 0 ELSE 1 END, name").all();
  const pendingDeletions = () => db.prepare("SELECT * FROM company_deletions WHERE status = 'pending' ORDER BY ends_at").all();

  /** Every company that isn't a demo copy and isn't deleted, HQ first. */
  function companies(workingIn) {
    const team = teamRows();
    const rows = db.prepare('SELECT * FROM companies WHERE demo = 0 AND deleted_at IS NULL ORDER BY internal DESC, name COLLATE NOCASE').all();
    const pend = new Map(pendingDeletions().map((d) => [d.company_id, d]));
    return rows.map((co) => {
      const stores = db.prepare('SELECT id, name FROM stores WHERE company_id = ? AND deleted_at IS NULL ORDER BY sort, id').all(co.id);
      const n = db.prepare(`SELECT SUM(role = 'owner') owners, SUM(role = 'manager') managers, SUM(role = 'staff') staff
        FROM users WHERE company_id = ? AND deleted_at IS NULL`).get(co.id);
      const used = bytesOf(ownedFiles(db, co.id));
      const hq = !!co.internal;
      const invite = hq ? null : openOwnerInvite(co.id);
      const d = pend.get(co.id);
      const plan = PLANS[co.plan] ? co.plan : DEFAULT_PLAN;
      return {
        id: co.id, name: co.name, hq, link: linkOf(co), createdAt: co.created_at, isNew: !!co.created_at && Date.parse(co.created_at) > Date.now() - 7 * DAY,
        plan, planName: PLANS[plan].name, lookName: (lookInfo(lookOf(co)) || LOOKS.mise).name,
        stores: stores.map((s) => s.name),
        owners: hq ? 0 : n.owners || 0, managers: hq ? 0 : n.managers || 0, staff: hq ? 0 : n.staff || 0, team: hq ? team.length : 0,
        storage: used, lastActiveAt: hq ? team.reduce((a, t) => (t.last_seen_at && t.last_seen_at > (a || '') ? t.last_seen_at : a), null) : lastSeenOf.get(co.id).at,
        workingHere: co.id === workingIn,
        ownerInvite: invite ? { email: invite.email, expiresAt: invite.expires_at, expired: Date.parse(invite.expires_at) <= Date.now() } : null,
        deletion: d ? { id: d.id, ready: Date.parse(d.ends_at) <= Date.now(), endsAt: d.ends_at } : null,
      };
    });
  }
  /** A company's newest owner invite, when it hasn't been used and nobody who runs the company has signed in yet. */
  function openOwnerInvite(companyId) {
    const someoneIn = db.prepare("SELECT 1 FROM users WHERE company_id = ? AND role IN ('owner','manager') AND deleted_at IS NULL AND last_seen_at IS NOT NULL").get(companyId);
    if (someoneIn) return null;
    const inv = db.prepare("SELECT * FROM invites WHERE company_id = ? AND role = 'owner' AND user_id IS NULL ORDER BY created_at DESC LIMIT 1").get(companyId);
    return inv && !inv.used_at ? inv : null;
  }
  /** Demo copies, one group per demo: how many are open and when one was last used (server/demo.mjs, the same list as
   *  Super Admin → Companies). Each copy is gone within a day, or when its visitor leaves. */
  const demoGroups = () => demoList(db).map((d) => ({ kind: d.kind, name: d.name, note: d.note, path: d.path, lookName: (lookInfo(d.brand) || LOOKS.mise).name, open: d.open, lastActiveAt: d.lastActiveAt }));
  /** Errors in the last `hours`, one line per kind + path + message (the table keeps a row per day). */
  function errorGroups(hours = 24) {
    return db.prepare(`SELECT kind, path, message, SUM(count) count, MIN(first_at) first_at, MAX(last_at) last_at FROM errors WHERE last_at >= ?
      GROUP BY kind, IFNULL(path, ''), message ORDER BY count DESC, last_at DESC`).all(isoAgo(hours * 3600e3));
  }
  function health(cos) {
    const errs = errorGroups(24);
    const snap = latestSnapshot();
    const ops = lastOps(db);
    const fresh = (iso, h) => !!iso && Date.parse(iso) > Date.now() - h * 3600e3;
    const lines = [
      { key: 'snapshot', title: 'Daily snapshot', note: `On the volume, kept ${KEEP_DAYS} days`, at: snap?.at ?? null, ok: fresh(snap?.at, FRESH_H.snapshot) },
      { key: 'backup', title: 'Encrypted off-site copy', note: 'Pulled every night', at: ops.backup?.at ?? null, ok: !!ops.backup?.ok && fresh(ops.backup.at, FRESH_H.backup), failed: ops.backup ? !ops.backup.ok : false },
      { key: 'files', title: 'Uploads and account files', note: 'Changes nightly, all on Sundays', at: ops.files?.at ?? null, ok: !!ops.files?.ok && fresh(ops.files.at, FRESH_H.files), failed: ops.files ? !ops.files.ok : false },
      { key: 'health', title: 'Health check', note: 'The app answers, every hour', at: ops.health?.at ?? null, ok: fresh(ops.health?.at, FRESH_H.health) },
    ];
    const free = volumeFree();
    return {
      errors: { total: errs.reduce((n, e) => n + e.count, 0), kinds: errs.length,
        top: errs.slice(0, 3).map((e) => ({ kind: e.kind, path: e.path, message: e.message, count: e.count, lastAt: e.last_at })) },
      backups: { allGood: lines.every((l) => l.ok), lines },
      storage: {
        capBytes: storageCapBytes(), floorBytes: volumeFloorBytes(), freeBytes: Number.isFinite(free) ? free : null,
        companies: cos.map((c) => ({ id: c.id, name: c.name, bytes: c.storage })).sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)),
      },
    };
  }
  /** Waiting on you: deletion requests past their 7 days, owner invites nobody used, errors that keep coming back. */
  function waiting(cos) {
    const out = [];
    for (const d of pendingDeletions()) {
      if (Date.parse(d.ends_at) > Date.now()) continue;
      out.push({ type: 'deletion', id: d.id, companyId: d.company_id, companyName: d.company_name, requestedBy: d.requested_name, requestedAt: d.requested_at, readyAt: d.ends_at,
        byHand: d.company_id === 1 });
    }
    for (const c of cos) {
      if (!c.ownerInvite) continue;
      out.push({ type: 'invite', companyId: c.id, companyName: c.name, planName: c.planName, createdAt: c.createdAt, isNew: c.isNew, email: c.ownerInvite.email,
        expiresAt: c.ownerInvite.expiresAt, expired: c.ownerInvite.expired });
    }
    for (const e of errorGroups(24)) {
      if (e.count < REPEAT_AT) continue;
      out.push({ type: 'error', kind: e.kind, path: e.path, message: e.message, count: e.count, firstAt: e.first_at, lastAt: e.last_at });
    }
    return out;
  }

  return async function route(req, res, url, c) {
    const m = req.method, p = url.pathname;
    if (p === '/api/super/home' && m === 'GET') {
      const s = needSuper(c);
      const cos = companies(c.company);
      const team = teamRows();
      const log = db.prepare(`SELECT a.id, a.action, a.detail, a.at, a.team_role, u.name, u.role, u.super_role, u.super_primary, co.name company FROM audit a
        LEFT JOIN users u ON u.id = a.user_id LEFT JOIN companies co ON co.id = a.company_id WHERE a.action LIKE 'super:%' ORDER BY a.id DESC LIMIT 6`).all();
      const week = cos.filter((x) => !x.hq && x.isNew).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return sendJson(res, 200, {
        you: { id: s.id, name: s.name, role: teamRole(s) }, can: teamCans(s), workingIn: c.company, hqId: hqId(), hqName: HQ_NAME, waitDays: WAIT_DAYS,
        waiting: waiting(cos), health: health(cos), companies: cos, demos: demoGroups(),
        activity: log.map(activityOut),
        newThisWeek: week.map((x) => ({ id: x.id, name: x.name, createdAt: x.createdAt, planName: x.planName, stores: x.stores.length })),
        team: team.map((t) => ({ id: t.id, name: t.name, initials: initials(t.name), role: teamRole(t), totpOn: !!t.totp_on, you: t.id === s.id, lastSeenAt: t.last_seen_at })),
        repeatAt: REPEAT_AT,
      });
    }
    if (p === '/api/super/counts' && m === 'GET') {
      needSuper(c);
      return sendJson(res, 200, {
        companies: db.prepare('SELECT COUNT(*) n FROM companies WHERE demo = 0 AND deleted_at IS NULL').get().n,
        team: teamRows().length,
        deletions: pendingDeletions().length,
      });
    }
    const pm = /^\/api\/super\/companies\/(\d+)\/people$/.exec(p);
    if (pm && m === 'GET') {
      needSuper(c, 'signInAs');
      const co = db.prepare('SELECT * FROM companies WHERE id = ? AND deleted_at IS NULL').get(Number(pm[1]));
      if (!co) fail(404, 'We couldn’t find that company.');
      if (co.internal) fail(400, 'Mise Academy (HQ)’s people are the Mise team. Super admins can’t sign in as each other.');
      if (co.demo) fail(400, 'That’s a demo copy. Open the demo instead.');
      const stores = db.prepare('SELECT id, name FROM stores WHERE company_id = ? AND deleted_at IS NULL ORDER BY sort, id').all(co.id);
      const storeName = new Map(stores.map((s) => [s.id, s.name]));
      const rows = db.prepare(`SELECT id, name, email, role, store_id, jobs, last_seen_at FROM users WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, name COLLATE NOCASE`).all(co.id);
      const out = (u) => ({ id: u.id, name: u.name, email: u.email, initials: initials(u.name), role: u.role,
        roleLabel: u.role === 'owner' ? 'Owner' : u.role === 'manager' ? 'Manager' : jobLabel(u.jobs) || 'Staff',
        storeName: u.role === 'owner' || (u.role === 'manager' && !u.store_id) ? 'All stores' : storeName.get(u.store_id) || null, lastSeenAt: u.last_seen_at });
      const staff = rows.filter((u) => u.role === 'staff');
      const order = [...stores.map((s) => s.id), null];
      return sendJson(res, 200, {
        company: { id: co.id, name: co.name }, total: rows.length,
        owners: rows.filter((u) => u.role === 'owner').map(out),
        managers: rows.filter((u) => u.role === 'manager').map(out),
        staff: order.map((sid) => ({ storeId: sid, storeName: sid == null ? 'No store' : storeName.get(sid), people: staff.filter((u) => (storeName.has(u.store_id) ? u.store_id : null) === sid).map(out) }))
          .filter((g) => g.people.length),
      });
    }
    if (p === '/api/super/errors' && m === 'GET') {
      needSuper(c, 'log');
      const days = [1, 7, 90].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 7;
      const kind = ['server', 'client', 'seen'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : '';
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
      const like = `%${q}%`;
      const rows = db.prepare(`SELECT e.id, e.kind, e.path, e.message, e.stack, e.count, e.first_at, e.last_at, u.name user_name, u.role user_role, co.name company
        FROM errors e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN companies co ON co.id = u.company_id
        WHERE e.last_at >= ? AND (? = '' OR e.kind = ?) AND (? = '' OR e.message LIKE ? OR IFNULL(e.path, '') LIKE ?)
        ORDER BY e.last_at DESC LIMIT 300`).all(isoAgo(days * DAY), kind, kind, q, like, like);
      const all = db.prepare('SELECT kind, COUNT(*) n, SUM(count) hits FROM errors WHERE last_at >= ? GROUP BY kind').all(isoAgo(days * DAY));
      return sendJson(res, 200, {
        days, kind: kind || 'all', q,
        totals: { server: all.find((r) => r.kind === 'server')?.n || 0, client: all.find((r) => r.kind === 'client')?.n || 0, seen: all.find((r) => r.kind === 'seen')?.n || 0 },
        errors: rows.map((r) => ({ id: r.id, kind: r.kind, path: r.path, message: r.message, stack: r.stack, count: r.count, firstAt: r.first_at, lastAt: r.last_at,
          user: r.user_name ? { name: r.user_name, role: r.user_role, company: r.company || (r.user_role === 'superadmin' ? HQ_NAME : null) } : null })),
      });
    }
    return false;
  };
}
