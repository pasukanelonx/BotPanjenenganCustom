// Daftar akun X "konten" yang dipantau SinyalTren (didaftarkan member lewat .pantau di chat pribadi).
// Disimpan di database/pantau.json (TIDAK ikut git: berisi nomor WA). Dibaca jembatan SinyalTren
// (deploy/mg-bridge.py) untuk menentukan akun yang dicek dan siapa yang di-mention saat ada perubahan.
import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'database', 'pantau.json');
export const MAX_PER_MEMBER = Number(process.env.PANTAU_MAX_PER_MEMBER || 30);
export const MAX_TOTAL = Number(process.env.PANTAU_MAX_TOTAL || 300);
export const USERNAME_RE = /^[a-z0-9_]{1,15}$/;

export function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return d && typeof d.accounts === 'object' ? d : { accounts: {} };
  } catch {
    return { accounts: {} };
  }
}

export function save(data) {
  const tmp = FILE + '.tmp';
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ ...data, updated: Date.now() }, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

/** Ambil username dari teks: @nama, nama, atau link x.com/nama. */
export function parseUsernames(text) {
  const out = [];
  const bad = [];
  for (const raw of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    const u = raw.trim().replace(/^(https?:\/\/)?(www\.|mobile\.)?(twitter|x)\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0].toLowerCase();
    if (USERNAME_RE.test(u)) { if (!out.includes(u)) out.push(u); } else bad.push(raw);
  }
  return { ok: out, bad };
}

const same = (a, who) => Boolean((who.pn && a.pn === who.pn) || (who.lid && a.lid === who.lid));

export function mine(data, who) {
  return Object.entries(data.accounts).filter(([, a]) => same(a, who)).map(([u, a]) => ({ username: u, ...a }));
}

export function add(who, name, usernames) {
  const data = load();
  const res = { added: [], taken: [], already: [], full: [] };
  for (const u of usernames) {
    const cur = data.accounts[u];
    if (cur) { (same(cur, who) ? res.already : res.taken).push(u); continue; }
    if (mine(data, who).length >= MAX_PER_MEMBER || Object.keys(data.accounts).length >= MAX_TOTAL) { res.full.push(u); continue; }
    data.accounts[u] = { pn: who.pn || null, lid: who.lid || null, name: name || '', added: Date.now() };
    res.added.push(u);
  }
  if (res.added.length) save(data);
  return res;
}

export function remove(who, usernames, isAdmin = false) {
  const data = load();
  const removed = [];
  const notMine = [];
  for (const u of usernames) {
    const cur = data.accounts[u];
    if (!cur) continue;
    if (same(cur, who) || isAdmin) { delete data.accounts[u]; removed.push(u); } else notMine.push(u);
  }
  if (removed.length) save(data);
  return { removed, notMine };
}
