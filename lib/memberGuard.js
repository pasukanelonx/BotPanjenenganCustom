// Jembatan bot WA <-> member-guard lewat API HTTP (member-guard berjalan di VPS lain).
// File ini baru; tidak mengubah file bot yang lain.
import config from '../config.js';
import { isOwner } from './users.js';

// Diatur lewat Variables di Railway (JANGAN tulis kunci di file ini, repo bot bersifat publik):
//   MEMBER_GUARD_URL = http://IP_VPS:8787
//   MEMBER_GUARD_KEY = API_KEY yang sama dengan .env member-guard
const MG_URL = process.env.MEMBER_GUARD_URL || '';
const MG_KEY = process.env.MEMBER_GUARD_KEY || '';

async function rpc(fn, ...args) {
  if (!MG_URL || !MG_KEY) throw new Error('MEMBER_GUARD_URL / MEMBER_GUARD_KEY belum diisi di Variables Railway');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${MG_URL.replace(/\/$/, '')}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': MG_KEY },
      body: JSON.stringify({ fn, args }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `API member-guard HTTP ${res.status}`);
    return data.result;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('API member-guard tidak menjawab (timeout)');
    if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(e.message)) throw new Error('API member-guard tidak bisa dihubungi');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// core.namaFungsi(...) -> panggilan API (selalu async)
const core = new Proxy({}, { get: (_, fn) => (...args) => rpc(fn, ...args) });

let cfgCache = { at: 0, data: null };
async function getCfg() {
  if (cfgCache.data && Date.now() - cfgCache.at < 60 * 1000) return cfgCache.data;
  cfgCache = { at: Date.now(), data: await rpc('config') };
  return cfgCache.data;
}

/* ---------- util kecil (salinan dari member-guard/src/util.js) ---------- */
const RESERVED = new Set(['home', 'explore', 'i', 'messages', 'notifications', 'settings', 'search', 'compose', 'login',
  'logout', 'signup', 'tos', 'privacy', 'about', 'hashtag', 'intent', 'share', 'account', 'jobs', 'premium', 'lists',
  'communities', 'bookmarks', 'chat', 'verified', 'grok', 'download']);
function normUser(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  const m = s.match(/(?:x|twitter)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i);
  if (m) s = m[1];
  s = s.replace(/^@+/, '').replace(/[.,;:!?)\]]+$/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(s)) return null;
  s = s.toLowerCase();
  return RESERVED.has(s) ? null : s;
}
function parseUsers(text) {
  const ok = [];
  const bad = [];
  for (const t of String(text ?? '').split(/[\s,]+/).filter(Boolean)) {
    const u = normUser(t);
    if (u) { if (!ok.includes(u)) ok.push(u); } else bad.push(t);
  }
  return { ok, bad };
}
function fmtWib(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WIB';
}
function chunkText(text, max = 3500) {
  const out = [];
  let cur = '';
  for (const line of String(text).split('\n')) {
    if ((cur + '\n' + line).length > max && cur) { out.push(cur); cur = line; } else cur = cur ? cur + '\n' + line : line;
  }
  if (cur) out.push(cur);
  return out;
}
const util = { normUser, parseUsers, fmtWib, chunkText };

export function itemTag(it) {
  const jid = it.pn || it.lid;
  return jid ? '@' + jid.split('@')[0] : it.name || '-';
}
export function ownerLabel(o) {
  if (!o) return '-';
  const num = o.wa_pn ? o.wa_pn.split('@')[0] : null;
  return `${o.name || 'tanpa nama'} ${num ? `(${num})` : '(nomor tersembunyi)'}`;
}

/** { core, cfg, util } — core berupa fungsi async lewat API. */
export async function mg() {
  return { core, cfg: await getCfg(), util };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bare = (j) => (j ? String(j).replace(/:\d+(?=@)/, '') : null);
const kind = (j) => (!j ? null : j.endsWith('@lid') ? 'lid' : j.endsWith('@s.whatsapp.net') ? 'pn' : null);

/* ---------------- identitas & keanggotaan ---------------- */

/** { pn, lid } pengirim, termasuk mode LID WhatsApp. */
export async function whoIs(sock, messageInfo) {
  const k = messageInfo.message?.key || {};
  const ids = [
    k.remoteJid, k.remoteJidAlt, k.participant, k.participantAlt, k.senderPn, k.participantPn,
    messageInfo.sender, messageInfo.senderLid,
  ].filter((j) => j && !String(j).endsWith('@g.us')).map(bare);
  let pn = ids.find((j) => kind(j) === 'pn') || null;
  let lid = ids.find((j) => kind(j) === 'lid') || null;
  const map = sock?.signalRepository?.lidMapping;
  try {
    if (lid && !pn && map?.getPNForLID) pn = bare(await map.getPNForLID(lid)) || null;
    if (pn && !lid && map?.getLIDForPN) lid = bare(await map.getLIDForPN(pn)) || null;
  } catch {}
  return { pn: kind(pn) === 'pn' ? pn : null, lid: kind(lid) === 'lid' ? lid : null };
}

const pIds = (p) => [p.id, p.phoneNumber, p.jid, p.lid].filter(Boolean).map(bare);
export const matchP = (p, { pn, lid }) => {
  const ids = pIds(p);
  return Boolean((pn && ids.includes(pn)) || (lid && ids.includes(lid)));
};
export const pnOf = (p) => pIds(p).find((j) => kind(j) === 'pn') || null;
export const lidOf = (p) => pIds(p).find((j) => kind(j) === 'lid') || null;

const metaCache = new Map();
export async function groupMeta(sock, jid, force = false) {
  if (!jid) return null;
  const c = metaCache.get(jid);
  if (!force && c && Date.now() - c.at < 5 * 60 * 1000) return c.data;
  const data = await sock.groupMetadata(jid);
  metaCache.set(jid, { at: Date.now(), data });
  return data;
}

/** Daftar JID grup member (WA_GROUP_JID boleh berisi beberapa grup). */
export const memberGroups = (cfg) =>
  (cfg.waGroups?.length ? cfg.waGroups.map((g) => g.jid) : cfg.waGroupJids?.length ? cfg.waGroupJids : [cfg.waGroupJid]).filter(Boolean);

/** Kirim daftar anggota tiap grup WA ke member-guard (dipakai untuk menghitung calon kick per grup). */
export async function syncWa(sock) {
  const { cfg } = await mg();
  const fams = cfg.waGroups || [];
  if (!fams.length || !sock?.user) return null;
  const list = [];
  for (const f of fams) {
    try {
      const meta = await groupMeta(sock, f.jid, true);
      list.push({ family: f.family, members: (meta?.participants || []).map((p) => ({ pn: pnOf(p), lid: lidOf(p), admin: !!p.admin })) });
    } catch (e) {
      console.error('[member-guard] sync grup', f.jid, e.message);
    }
  }
  return list.length ? core.syncWaMembers(list) : null;
}

/** Metadata semua grup member: [{ gid, meta }] (grup yang gagal dibaca dilewati). */
export async function memberMetas(sock, force = false) {
  const { cfg } = await mg();
  const out = [];
  for (const gid of memberGroups(cfg)) {
    try {
      out.push({ gid, meta: await groupMeta(sock, gid, force) });
    } catch (e) {
      console.error('[member-guard] metadata grup', gid, e.message);
    }
  }
  return out;
}

/** Cari orang di salah satu grup member. */
export async function findMember(sock, who) {
  for (const force of [false, true]) {
    for (const { meta } of await memberMetas(sock, force)) {
      const p = meta?.participants?.find((x) => matchP(x, who));
      if (p) return p;
    }
  }
  // tidak ada di grup anggota: cek anggota KOMUNITAS (grup pengumuman komunitas yang menaungi grup anggota)
  return findCommunityMember(sock, who);
}

let commCache = { at: 0, ann: [] };
/** Cari orang di grup pengumuman komunitas (berisi semua anggota komunitas). */
export async function findCommunityMember(sock, who) {
  try {
    const { cfg } = await mg();
    if (!commCache.ann.length || Date.now() - commCache.at > 10 * 60 * 1000) {
      const groups = Object.values((await sock.groupFetchAllParticipating()) || {});
      const memberJids = memberGroups(cfg);
      const parents = new Set(groups.filter((g) => memberJids.includes(g.id) && g.linkedParent).map((g) => g.linkedParent));
      commCache = { at: Date.now(), ann: groups.filter((g) => g.isCommunityAnnounce && parents.has(g.linkedParent)).map((g) => g.id) };
    }
    for (const force of [false, true]) {
      for (const jid of commCache.ann) {
        const meta = await groupMeta(sock, jid, force).catch(() => null);
        const p = meta?.participants?.find((x) => matchP(x, who));
        if (p) return p;
      }
    }
  } catch (e) {
    console.error('[member-guard] cek komunitas:', e.message);
  }
  return null;
}

export async function adminGroupJid() {
  const { cfg } = await mg();
  return cfg.waAdminGroupJid || config.group_laporan || null;
}

/** Admin = owner bot, nomor di WA_ADMIN_NUMBERS, anggota grup admin, atau admin grup member. */
export async function isMgAdmin(sock, messageInfo, who) {
  const { cfg } = await mg();
  if ([messageInfo.sender, messageInfo.senderLid, who.pn, who.lid].some((j) => j && isOwner(j))) return true;
  if (who.pn && cfg.waAdminNumbers.includes(who.pn.split('@')[0])) return true;
  try {
    const ag = await adminGroupJid();
    if (ag) {
      const meta = await groupMeta(sock, ag);
      if (meta?.participants?.some((p) => matchP(p, who))) return true;
    }
    for (const { meta } of await memberMetas(sock)) {
      const p = meta?.participants?.find((x) => matchP(x, who));
      if (p && (p.admin === 'admin' || p.admin === 'superadmin')) return true;
    }
  } catch {}
  return false;
}

/* ---------------- sesi pendaftaran di chat pribadi ---------------- */

const sessions = new Map();
const SESSION_TTL = 10 * 60 * 1000;
const keysOf = (mi) => [mi.sender, mi.senderLid, mi.remoteJid].filter(Boolean);
export function openSession(mi) {
  for (const k of keysOf(mi)) sessions.set(k, Date.now() + SESSION_TTL);
}
export function hasSession(mi) {
  return keysOf(mi).some((k) => (sessions.get(k) || 0) > Date.now());
}
export function closeSession(mi) {
  for (const k of keysOf(mi)) sessions.delete(k);
}

/* ---------------- pendaftaran ---------------- */

/** Daftarkan akun dari teks bebas. Mengembalikan teks balasan. */
export async function registerFromText(sock, messageInfo, text) {
  const { core, cfg, util } = await mg();
  if (!memberGroups(cfg).length) return '⚠️ Pendataan belum diatur (WA_GROUP_JID kosong). Hubungi admin.';
  const { ok, bad } = util.parseUsers(text);
  if (!ok.length) {
    return 'Tulis username akun X-nya, pisahkan dengan spasi atau baris baru.\nContoh:\n*akunsatu akundua*';
  }
  const who = await whoIs(sock, messageInfo);
  const me = await findMember(sock, who);
  if (!me) {
    return '⛔ Nomormu tidak terdaftar sebagai anggota grup member maupun komunitas, jadi akun tidak bisa didaftarkan.\nKalau kamu memang anggota, hubungi admin.';
  }
  const full = { pn: who.pn || pnOf(me), lid: who.lid || lidOf(me) };
  if (await core.isWaBlacklisted(full)) return '⛔ Nomormu tidak bisa mendaftarkan akun. Hubungi admin.';
  const owner = await core.upsertOwner({ ...full, name: messageInfo.pushName || null });
  // pernah dikick dari grup WA karena belum daftar, sekarang mendaftar dari komunitas -> aktif lagi
  if (owner?.status && owner.status !== 'aktif') await core.setOwnerStatus(owner.id, 'aktif');
  const r = await core.registerAccounts(owner.id, ok);
  const at = (a) => a.map((u) => '@' + u).join(', ');
  const lines = [];
  if (r.added.length) lines.push(`✅ Terdaftar: ${at(r.added)}`);
  if (r.mine.length) lines.push(`ℹ️ Sudah milikmu: ${at(r.mine)}`);
  if (r.taken.length) lines.push(`⛔ Sudah didaftarkan orang lain: ${at(r.taken.map((t) => t.username))}\nKalau itu akunmu, hubungi admin.`);
  if (r.limit.length) lines.push(`⛔ Melebihi batas ${cfg.maxAccounts} akun: ${at(r.limit)}`);
  if (r.blocked?.length) lines.push(`⛔ Tidak bisa didaftarkan: ${at(r.blocked)}`);
  if (bad.length) lines.push(`❓ Tidak valid: ${bad.join(', ')}`);
  lines.push(`\nTotal akunmu: ${(await core.ownerAccounts(owner.id)).length}. Cek dengan *.akunku*`);
  for (const t of r.taken) {
    await core.enqueue('wa', `⚠️ *Bentrok kepemilikan* @${t.username}\nPemilik terdaftar: ${ownerLabel(t.owner)}\nDiklaim oleh: ${ownerLabel(owner)}\nPindahkan: *.mglepas ${t.username}*, lalu minta pengklaim daftar ulang.`);
  }
  await core.log(who.pn || who.lid, 'daftar', { owner: owner.id, added: r.added, taken: r.taken.map((t) => t.username) });
  return lines.join('\n');
}

/* ---------------- kirim antrean pesan dari member-guard ---------------- */

export function rememberSock(sock) {
  globalThis.__mgSock = sock;
  if (globalThis.__mgTimer) return;
  globalThis.__mgTimer = setInterval(() => flushOutbox().catch((e) => console.error('[member-guard] outbox:', e.message)), 6000);
  // sinkron anggota grup WA: 30 detik setelah start, lalu tiap 30 menit
  const doSync = () => syncWa(globalThis.__mgSock).catch((e) => console.error('[member-guard] sync:', e.message));
  setTimeout(doSync, 30 * 1000);
  setInterval(doSync, 30 * 60 * 1000);
}

let flushing = false;
async function flushOutbox() {
  const sock = globalThis.__mgSock;
  if (flushing || !sock?.user) return;
  flushing = true;
  try {
    const { core, util } = await mg();
    const to = await adminGroupJid();
    if (!to) return;
    for (const m of await core.takeOutbox('wa', 5)) {
      for (const part of util.chunkText(m.text, 3500)) await sock.sendMessage(to, { text: part, mentions: m.mentions });
      await core.markSent(m.id);
      await sleep(1500);
    }
  } finally {
    flushing = false;
  }
}

/* ---------------- kick ---------------- */

/** Member (dari semua grup member, tanpa duplikat) yang belum mendaftar akun X. */
/** onlyGid: hanya anggota grup WA itu (kosong = semua grup member) */
export async function itemsUnregistered(sock, onlyGid = null) {
  const me = [sock.user?.id, sock.user?.lid].filter(Boolean).map(bare);
  const seen = new Set();
  const people = [];
  for (const { gid, meta } of await memberMetas(sock, true)) {
    if (onlyGid && gid !== onlyGid) continue;
    for (const p of meta?.participants || []) {
      if (p.admin || pIds(p).some((j) => me.includes(j))) continue;
      const who = { pn: pnOf(p), lid: lidOf(p) };
      const keys = [who.pn, who.lid].filter(Boolean);
      if (!keys.length || keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
      people.push(who);
    }
  }
  return core.unregisteredAmong(people);
}


/**
 * Anggota KOMUNITAS (bukan hanya grup anggota) yang belum mendaftarkan akun X.
 * Sumber: grup pengumuman komunitas (berisi semua anggota komunitas) dari komunitas yang menaungi grup WA anggota.
 * Mengembalikan { items, parents, error }. Tiap item membawa comm (JID komunitas) dan cid (ID peserta) untuk kick.
 */
export async function itemsUnregisteredCommunity(sock) {
  const { core, cfg } = await mg();
  const me = [sock.user?.id, sock.user?.lid].filter(Boolean).map(bare);
  let all = {};
  try { all = await sock.groupFetchAllParticipating(); } catch (e) { return { error: `tidak bisa membaca daftar grup: ${e.message}` }; }
  const groups = Object.values(all || {});
  const memberJids = memberGroups(cfg);
  const parents = [...new Set(groups.filter((g) => memberJids.includes(g.id) && g.linkedParent).map((g) => g.linkedParent))];
  if (!parents.length) return { error: 'Grup WA anggota tidak tertaut ke komunitas (atau info komunitas tidak terbaca).' };
  const seen = new Set();
  const people = [];
  const src = [];
  for (const par of parents) {
    let parts = [];
    const ann = groups.find((g) => g.linkedParent === par && g.isCommunityAnnounce);
    if (ann) {
      try { parts = (await sock.groupMetadata(ann.id))?.participants || []; } catch { parts = ann.participants || []; }
      src.push(ann.subject || ann.id);
    }
    if (!parts.length && typeof sock.communityMetadata === 'function') {
      try { parts = (await sock.communityMetadata(par))?.participants || []; src.push(`komunitas ${par}`); } catch {}
    }
    for (const p of parts) {
      if (p.admin || pIds(p).some((j) => me.includes(j))) continue;
      const who = { pn: pnOf(p), lid: lidOf(p) };
      const keys = [who.pn, who.lid].filter(Boolean);
      if (!keys.length || keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
      people.push({ ...who, comm: par, cid: p.id });
    }
  }
  if (!people.length) return { error: 'Daftar anggota komunitas kosong / tidak terbaca (bot harus anggota grup pengumuman komunitas).' };
  const unreg = await core.unregisteredAmong(people);
  const byKey = new Map(people.flatMap((x) => [[x.pn, x], [x.lid, x]].filter(([k]) => k)));
  const items = unreg.map((u) => {
    const src0 = byKey.get(u.pn) || byKey.get(u.lid) || {};
    return { ...u, comm: src0.comm, cid: src0.cid };
  }).filter((it) => it.comm);
  return { items, parents, sources: src, scanned: people.length };
}

// Kick dari KOMUNITAS (keluar dari semua grup tertaut) atau per GRUP dipilih saat menjalankan:
//   .mgkick ID komunitas   |   .mgkick ID grup
// Tanpa pilihan: bawaan per grup. Jenis laporan yang bawaannya komunitas bisa diatur di Variables Railway,
// mis. MG_COMMUNITY_KICK=belumdaftar,blacklist (kosong/off = semua bawaan per grup).
const COMMUNITY_KICK_KINDS = ['', 'off'].includes(String(process.env.MG_COMMUNITY_KICK ?? '').toLowerCase())
  ? []
  : String(process.env.MG_COMMUNITY_KICK).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
// laporan jenis ini boleh di-kick lewat komunitas (akun hilang dari grup XChat tertentu tidak: bisa masih sah di grup lain)
const COMMUNITY_ALLOWED = ['belumdaftar', 'blacklist', 'komunitas'];

export async function executeKick(sock, reportId, args, by) {
  const { core, cfg } = await mg();
  const rep = await core.getReport(reportId);
  if (!rep) return { text: 'Laporan tidak ditemukan.' };
  if (rep.status !== 'pending') return { text: `Laporan #${reportId} sudah ${rep.status}.` };
  const skip = new Set(args.filter((a) => /^-\d+$/.test(a)).map((a) => Number(a.slice(1))));
  const force = args.some((a) => a.toLowerCase() === 'paksa');
  const wantCommunity = args.some((a) => /^komunitas$|^community$/i.test(a));
  const wantGroup = args.some((a) => /^grup$|^group$/i.test(a));
  if (wantCommunity && !COMMUNITY_ALLOWED.includes(rep.kind)) {
    return { text: `Laporan #${reportId} (${rep.kind}) tidak bisa di-kick lewat komunitas: orangnya mungkin masih sah di grup lain. Jalankan tanpa "komunitas".` };
  }
  const useCommunity = wantCommunity || (!wantGroup && COMMUNITY_KICK_KINDS.includes(rep.kind));
  const items = rep.items.map((it, i) => ({ ...it, no: i + 1 })).filter((it) => !skip.has(it.no));
  if (!items.length) return { text: 'Tidak ada yang di-kick.' };
  if (items.length > cfg.maxKickPerRun && !force) {
    return { text: `Laporan ini berisi ${items.length} orang (batas ${cfg.maxKickPerRun}). Kalau yakin: *.mgkick ${reportId} paksa*` };
  }

  await core.closeReport(reportId, 'diproses', by);
  const metas = await memberMetas(sock, true);
  const done = [];
  const skipped = [];
  for (const it of items) {
    const label = `${it.no}. ${itemTag(it)}`;
    // laporan .mgkickkomunitas: langsung keluarkan dari komunitas (orangnya mungkin sudah tidak di grup anggota mana pun)
    if (rep.kind === 'komunitas' && it.comm) {
      const o = await core.findOwner(it);
      if (o && (await core.ownerAccounts(o.id)).length) { skipped.push(`${label} — sudah mendaftar`); continue; }
      try {
        const r = await sock.communityParticipantsUpdate(it.comm, [it.cid || it.lid || it.pn], 'remove');
        const st = Array.isArray(r) && r[0]?.status;
        if (st && st !== '200') throw new Error(`status ${st}`);
        if (it.owner_id) await core.setOwnerStatus(it.owner_id, 'dikick');
        done.push(`${label} (dari komunitas)`);
      } catch (e) {
        skipped.push(`${label} — gagal: ${e.message}${/not-authorized|forbidden|403/i.test(e.message) ? ' (bot belum admin komunitas)' : ''}`);
      }
      await sleep(cfg.kickDelayMs + Math.floor(Math.random() * 1500));
      continue;
    }
    // posisi orang ini di setiap grup member
    const spots = metas
      .filter(({ gid }) => !it.gid || gid === it.gid) // laporan per grup: kick hanya dari grup WA pasangannya
      .map(({ gid, meta }) => ({ gid, parent: meta?.linkedParent || null, p: meta?.participants?.find((x) => matchP(x, it)) }))
      .filter((s) => s.p);
    if (!spots.length) { skipped.push(`${label} — sudah tidak di grup`); continue; }
    if (spots.some((s) => s.p.admin)) { skipped.push(`${label} — admin grup`); continue; }
    if (rep.kind === 'hilang' && !await core.stillQualifies(it)) { skipped.push(`${label} — akunnya terlihat lagi / daftar ulang`); continue; }
    if (rep.kind === 'blacklist' && !await core.stillQualifies(it)) { skipped.push(`${label} — sudah dihapus dari blacklist`); continue; }
    if (rep.kind === 'belumdaftar') {
      const o = await core.findOwner(it);
      if (o && (await core.ownerAccounts(o.id)).length) { skipped.push(`${label} — sudah mendaftar`); continue; }
    }
    let ok = 0;
    const errs = [];
    // Kick lewat KOMUNITAS (keluar dari komunitas + semua grup yang tertaut sekaligus) untuk laporan belum daftar / blacklist.
    // Kalau gagal (mis. bot bukan admin komunitas), otomatis kembali ke kick per grup.
    let viaCommunity = false;
    let communityErr = null;
    const parents = [...new Set(spots.map((sp) => sp.parent).filter(Boolean))];
    if (useCommunity && parents.length && typeof sock.communityParticipantsUpdate === 'function') {
      for (const par of parents) {
        try {
          const r = await sock.communityParticipantsUpdate(par, [spots[0].p.id], 'remove');
          const st = Array.isArray(r) && r[0]?.status;
          if (st && st !== '200') throw new Error(`status ${st}`);
          viaCommunity = true;
        } catch (e) {
          communityErr = e.message;
        }
      }
    }
    if (viaCommunity) {
      ok = spots.length;
    } else {
      for (const s of spots) {
        try {
          await sock.groupParticipantsUpdate(s.gid, [s.p.id], 'remove');
          ok++;
        } catch (e) {
          errs.push(e.message);
        }
        if (spots.length > 1) await sleep(1500);
      }
    }
    if (ok) {
      if (it.owner_id && (!it.gid || viaCommunity)) await core.setOwnerStatus(it.owner_id, 'dikick');
      done.push(viaCommunity ? `${label} (dari komunitas)` : (spots.length > 1 ? `${label} (${ok}/${spots.length} grup)` : label) + (communityErr ? ` — per grup, kick komunitas gagal: ${communityErr}` : ''));
    }
    if (errs.length) skipped.push(`${label} — gagal di ${errs.length} grup: ${errs[0]}`);
    await sleep(cfg.kickDelayMs + Math.floor(Math.random() * 1500));
  }
  await core.closeReport(reportId, 'selesai', by, { done, skipped });
  await syncWa(sock).catch(() => {});
  await core.log(by, 'kick', { id: reportId, done: done.length, skipped: skipped.length });
  const text = `✅ Laporan #${reportId} selesai.\nDikick (${done.length}):\n${done.join('\n') || '-'}\n\nDilewati (${skipped.length}):\n${skipped.join('\n') || '-'}`;
  await core.enqueue('tg', text);
  return { text, mentions: items.map((it) => it.pn || it.lid).filter(Boolean) };
}
