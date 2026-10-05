// Jembatan bot WA <-> project member-guard (database & logika ada di member-guard).
// File ini baru; tidak mengubah file bot yang lain.
import path from 'path';
import { pathToFileURL } from 'url';
import config from '../config.js';
import { isOwner } from './users.js';

// Lokasi folder member-guard di VPS (bisa diatur lewat env MEMBER_GUARD_DIR)
export const MG_DIR = process.env.MEMBER_GUARD_DIR || '/opt/member-guard';

let loaded = null;
/** Muat core.js, config.js, util.js milik member-guard (sekali saja). */
export async function mg() {
  if (loaded) return loaded;
  const imp = (f) => import(pathToFileURL(path.join(MG_DIR, 'src', f)).href);
  const [core, conf, util] = await Promise.all([imp('core.js'), imp('config.js'), imp('util.js')]);
  loaded = { core, cfg: conf.cfg, util };
  return loaded;
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

export async function findMember(sock, who) {
  const { cfg } = await mg();
  let meta = await groupMeta(sock, cfg.waGroupJid);
  let p = meta?.participants?.find((x) => matchP(x, who));
  if (!p) {
    meta = await groupMeta(sock, cfg.waGroupJid, true);
    p = meta?.participants?.find((x) => matchP(x, who));
  }
  return p || null;
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
    const mm = await groupMeta(sock, cfg.waGroupJid);
    const p = mm?.participants?.find((x) => matchP(x, who));
    if (p && (p.admin === 'admin' || p.admin === 'superadmin')) return true;
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
  if (!cfg.waGroupJid) return '⚠️ Pendataan belum diatur (WA_GROUP_JID kosong). Hubungi admin.';
  const { ok, bad } = util.parseUsers(text);
  if (!ok.length) {
    return 'Tulis username akun X-nya, pisahkan dengan spasi atau baris baru.\nContoh:\n*akunsatu akundua*';
  }
  const who = await whoIs(sock, messageInfo);
  const me = await findMember(sock, who);
  if (!me) {
    return '⛔ Nomormu tidak terdaftar sebagai anggota grup member, jadi akun tidak bisa didaftarkan.\nKalau kamu memang anggota, hubungi admin.';
  }
  const owner = core.upsertOwner({ pn: who.pn || pnOf(me), lid: who.lid || lidOf(me), name: messageInfo.pushName || null });
  const r = core.registerAccounts(owner.id, ok);
  const at = (a) => a.map((u) => '@' + u).join(', ');
  const lines = [];
  if (r.added.length) lines.push(`✅ Terdaftar: ${at(r.added)}`);
  if (r.mine.length) lines.push(`ℹ️ Sudah milikmu: ${at(r.mine)}`);
  if (r.taken.length) lines.push(`⛔ Sudah didaftarkan orang lain: ${at(r.taken.map((t) => t.username))}\nKalau itu akunmu, hubungi admin.`);
  if (r.limit.length) lines.push(`⛔ Melebihi batas ${cfg.maxAccounts} akun: ${at(r.limit)}`);
  if (bad.length) lines.push(`❓ Tidak valid: ${bad.join(', ')}`);
  lines.push(`\nTotal akunmu: ${core.ownerAccounts(owner.id).length}. Cek dengan *.akunku*`);
  for (const t of r.taken) {
    core.enqueue('wa', `⚠️ *Bentrok kepemilikan* @${t.username}\nPemilik terdaftar: ${core.ownerLabel(t.owner)}\nDiklaim oleh: ${core.ownerLabel(owner)}\nPindahkan: *.mglepas ${t.username}*, lalu minta pengklaim daftar ulang.`);
  }
  core.log(who.pn || who.lid, 'daftar', { owner: owner.id, added: r.added, taken: r.taken.map((t) => t.username) });
  return lines.join('\n');
}

/* ---------------- kirim antrean pesan dari member-guard ---------------- */

export function rememberSock(sock) {
  globalThis.__mgSock = sock;
  if (globalThis.__mgTimer) return;
  globalThis.__mgTimer = setInterval(() => flushOutbox().catch((e) => console.error('[member-guard] outbox:', e.message)), 6000);
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
    for (const m of core.takeOutbox('wa', 5)) {
      for (const part of util.chunkText(m.text, 3500)) await sock.sendMessage(to, { text: part, mentions: m.mentions });
      core.markSent(m.id);
      await sleep(1500);
    }
  } finally {
    flushing = false;
  }
}

/* ---------------- kick ---------------- */

export function itemsUnregistered(core, meta, sock) {
  const me = [sock.user?.id, sock.user?.lid].filter(Boolean).map(bare);
  const out = [];
  for (const p of meta?.participants || []) {
    if (p.admin || pIds(p).some((j) => me.includes(j))) continue;
    const who = { pn: pnOf(p), lid: lidOf(p) };
    const o = core.findOwner(who);
    if (o && core.ownerAccounts(o.id).length) continue;
    out.push({ owner_id: o?.id ?? null, name: o?.name ?? null, pn: who.pn, lid: who.lid, accounts: [] });
  }
  return out;
}

export async function executeKick(sock, reportId, args, by) {
  const { core, cfg } = await mg();
  const rep = core.getReport(reportId);
  if (!rep) return { text: 'Laporan tidak ditemukan.' };
  if (rep.status !== 'pending') return { text: `Laporan #${reportId} sudah ${rep.status}.` };
  const skip = new Set(args.filter((a) => /^-\d+$/.test(a)).map((a) => Number(a.slice(1))));
  const force = args.some((a) => a.toLowerCase() === 'paksa');
  const items = rep.items.map((it, i) => ({ ...it, no: i + 1 })).filter((it) => !skip.has(it.no));
  if (!items.length) return { text: 'Tidak ada yang di-kick.' };
  if (items.length > cfg.maxKickPerRun && !force) {
    return { text: `Laporan ini berisi ${items.length} orang (batas ${cfg.maxKickPerRun}). Kalau yakin: *.mgkick ${reportId} paksa*` };
  }

  core.closeReport(reportId, 'diproses', by);
  const meta = await groupMeta(sock, cfg.waGroupJid, true);
  const done = [];
  const skipped = [];
  for (const it of items) {
    const label = `${it.no}. ${core.itemTag(it)}`;
    const p = meta?.participants?.find((x) => matchP(x, it));
    if (!p) { skipped.push(`${label} — sudah tidak di grup`); if (it.owner_id) core.setOwnerStatus(it.owner_id, 'keluar'); continue; }
    if (p.admin) { skipped.push(`${label} — admin grup`); continue; }
    if (rep.kind === 'hilang' && !core.stillQualifies(it)) { skipped.push(`${label} — akunnya terlihat lagi / daftar ulang`); continue; }
    if (rep.kind === 'belumdaftar') {
      const o = core.findOwner(it);
      if (o && core.ownerAccounts(o.id).length) { skipped.push(`${label} — sudah mendaftar`); continue; }
    }
    try {
      await sock.groupParticipantsUpdate(cfg.waGroupJid, [p.id], 'remove');
      if (it.owner_id) core.setOwnerStatus(it.owner_id, 'dikick');
      done.push(label);
    } catch (e) {
      skipped.push(`${label} — gagal: ${e.message}`);
    }
    await sleep(cfg.kickDelayMs + Math.floor(Math.random() * 1500));
  }
  core.closeReport(reportId, 'selesai', by, { done, skipped });
  core.log(by, 'kick', { id: reportId, done: done.length, skipped: skipped.length });
  const text = `✅ Laporan #${reportId} selesai.\nDikick (${done.length}):\n${done.join('\n') || '-'}\n\nDilewati (${skipped.length}):\n${skipped.join('\n') || '-'}`;
  core.enqueue('tg', text);
  return { text, mentions: items.map((it) => it.pn || it.lid).filter(Boolean) };
}
