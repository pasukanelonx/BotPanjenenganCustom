// Link undangan grup XChat untuk .kiw join.
// Bawaan dari config.js (GRUP_JOIN); link yang diperbarui admin lewat .mglink disimpan di
// database/grup_join.json (tidak ikut git, tetap ada walau bot restart / git pull).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'database', 'grup_join.json');
export const LINK_RE = /^https:\/\/(?:x|twitter)\.com\/i\/chat\/group_join\/g(\d+)\/[A-Za-z0-9_-]+\/?$/;

function readOverrides() {
  try {
    const o = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function writeOverrides(o) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 1));
  fs.renameSync(tmp, FILE);
}

/** Daftar grup untuk .kiw join: [{ no, nama, link, diubah? }] */
export function getGrupJoin() {
  const o = readOverrides();
  return (config.grup_join || []).map((g) => {
    const x = o[g.no];
    return x && x.link ? { ...g, link: x.link, diubah: x.at, oleh: x.by } : { ...g };
  });
}

/** Ubah link satu grup. Mengembalikan { ok, error?, beda? } (beda = ID grup lain dari link lama). */
export function setGrupLink(no, link, by = '') {
  const g = (config.grup_join || []).find((x) => x.no === Number(no));
  if (!g) return { ok: false, error: `nomor ${no} tidak ada` };
  const clean = String(link || '').trim().replace(/[?#].*$/, '');
  const m = clean.match(LINK_RE);
  if (!m) return { ok: false, error: 'bukan link undangan grup XChat (https://x.com/i/chat/group_join/g…/…)' };
  const oldId = (String(g.link).match(LINK_RE) || [])[1];
  const o = readOverrides();
  o[g.no] = { link: clean, at: new Date().toISOString(), by };
  writeOverrides(o);
  return { ok: true, beda: oldId && oldId !== m[1] };
}

/** Kembalikan ke link bawaan config.js. */
export function resetGrupLink(no) {
  const o = readOverrides();
  if (!o[no]) return false;
  delete o[no];
  writeOverrides(o);
  return true;
}
