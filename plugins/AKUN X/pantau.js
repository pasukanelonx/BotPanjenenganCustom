// Pantau akun konten (akun untuk upload postingan) oleh SinyalTren. Semua lewat CHAT PRIBADI (privasi):
// .pantau                → lihat akun konten yang kamu pantau, lalu bot menunggu username (sesi 10 menit)
// .pantau user1 user2 …  → tambah (maks. PANTAU_MAX_PER_MEMBER akun per member, bawaan 30)
// .unpantau 2 / username → berhenti memantau
// .pantau semua          → (admin) rekap status semua akun yang dipantau
// .pantau cek [user …]   → cek lengkap sekarang (maks. 5 akun; admin boleh akun siapa pun)
// .pantau cek semua      → (admin) jadwalkan cek lengkap semua akun lewat antrean SinyalTren
// Syarat: anggota grup member / komunitas. Notifikasi perubahan status dikirim lewat chat pribadi.
// Username dicek ke X lewat SinyalTren (SINYALTREN_URL + SINYALTREN_TOKEN = ADMIN_TOKEN SinyalTren) bila diatur.
import { whoIs, findMember, findCommunityMember, isMgAdmin, closeSession } from '../../lib/memberGuard.js';
import { clearKiwSession } from '../../lib/kiwSession.js';
import * as store from '../../lib/pantauStore.js';

const ST_URL = (process.env.SINYALTREN_URL || 'https://sinyaltren.tech').replace(/\/$/, '');
const ST_TOKEN = (process.env.SINYALTREN_TOKEN || '').trim();

/** Cek username ke X lewat SinyalTren. Mengembalikan {username: {status,...}} atau null bila tidak bisa dicek. */
async function checkX(usernames) {
  if (!ST_TOKEN || !usernames.length) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 25000);
    const r = await fetch(`${ST_URL}/api/admin/xuser?u=${encodeURIComponent(usernames.join(','))}`, {
      headers: { 'x-admin-token': ST_TOKEN }, signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.warn('[pantau] cek X gagal:', e.message);
    return null;
  }
}

/** Daftarkan username dari teks (dipakai .pantau user1 user2 dan sesi setelah .pantau). Mengembalikan teks balasan. */
export async function registerPantau(messageInfo, who, args, p = '.') {
    const data = store.load();
    const { ok, bad } = store.parseUsernames(args);
    if (!ok.length) return (`Tulis username akun X-nya, boleh beberapa sekaligus.\nContoh: *${p}pantau akunkonten1 akunkonten2*` + (bad.length ? `\n\n⚠️ Bukan username valid: ${bad.join(', ')}` : ''));

    // Cek ke X: username salah ketik / tidak ada / suspend / dikunci langsung ketahuan
    const fresh = ok.filter((u) => !data.accounts[u]);
    let cek = null;
    for (let i = 0; i < fresh.length; i += 10) { // SinyalTren menerima maks. 10 username per permintaan
      const part = await checkX(fresh.slice(i, i + 10));
      if (part) cek = { ...(cek || {}), ...part };
    }
    const rejected = [];
    const accept = [];
    for (const u of ok) {
      const c = cek?.[u];
      if (!c || c.status === 'ok' || c.status === 'error') { accept.push(u); continue; }
      if (c.status === 'not_found') rejected.push(`@${u} — tidak ditemukan di X (salah ketik? ganti nama?)`);
      else if (c.status === 'suspended') rejected.push(`@${u} — akun ini sedang di-suspend X`);
      else if (c.status === 'protected') rejected.push(`@${u} — akun digembok (protected), shadowban tidak bisa dicek`);
      else rejected.push(`@${u} — akun tidak tersedia di X${c.reason ? ` (${c.reason})` : ''}`);
    }
    const r = store.add(who, messageInfo.pushName, accept);
    const lines = [];
    if (r.added.length) lines.push(`✅ *Mulai dipantau:* ${r.added.map((u) => '@' + u).join(', ')}\n_Cek pertama berjalan dalam ±1 hari (bergiliran). Kabarnya dikirim ke chat ini. Mau langsung? Ketik *${p}pantau cek* (±10 menit setelah didaftarkan)._`);
    if (r.already.length) lines.push(`ℹ️ Sudah kamu pantau: ${r.already.map((u) => '@' + u).join(', ')}`);
    if (r.taken.length) lines.push(`⚠️ Sudah dipantau member lain: ${r.taken.map((u) => '@' + u).join(', ')} (hubungi admin kalau itu akunmu)`);
    if (r.full.length) lines.push(`⚠️ Tidak ditambahkan (batas ${store.MAX_PER_MEMBER} akun per member, atau kuota penuh): ${r.full.map((u) => '@' + u).join(', ')}`);
    if (rejected.length) lines.push(`❌ *Tidak bisa dipantau:*\n${rejected.map((x) => '• ' + x).join('\n')}`);
    if (bad.length) lines.push(`⚠️ Bukan username valid: ${bad.join(', ')}`);
    if (!cek && r.added.length) lines.push('_Username belum bisa dicek ke X sekarang; kalau salah ketik, akan ketahuan saat cek pertama._');
    return lines.join('\n\n') || '_Tidak ada perubahan._';
}

const TEST_LABEL = { typeahead: 'Saran pencarian', search: 'Search ban', ghost: 'Ghost ban', deboost: 'Reply deboosting' };
const STATUS_ICON = { clear: '✅', banned: '❌', unknown: '❔', skipped: '➖' };
const VERDICT_TEXT = {
  CLEAR: '✅ *Aman* — tidak ada pembatasan terdeteksi',
  RESTRICTED: '⚠️ *Terbatas* — ada pembatasan',
  NOT_FOUND: '❌ Akun tidak ditemukan di X',
  SUSPENDED: '⛔ Akun sedang di-suspend X',
  UNAVAILABLE: '⛔ Akun tidak tersedia di X',
  PROTECTED: '🔒 Akun digembok, tidak bisa dicek',
  NO_TWEETS: 'ℹ️ Akun belum punya postingan, tidak bisa dicek',
};

/** Cek lengkap satu akun pantau SEKARANG lewat SinyalTren. */
async function checkNow(username) {
  if (!ST_TOKEN) return { status: 'no_token' };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 180000); // cek lengkap bisa 1-2 menit
    const r = await fetch(`${ST_URL}/api/admin/pantau-cek?u=${encodeURIComponent(username)}`, {
      headers: { 'x-admin-token': ST_TOKEN }, signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return { status: 'error', code: `HTTP ${r.status}` };
    return (await r.json())[username.toLowerCase()] || { status: 'error' };
  } catch (e) {
    return { status: 'error', code: e.name === 'AbortError' ? 'waktu habis' : e.message };
  }
}

/** Status pantau banyak akun dari SinyalTren; queue=true menjadwalkan cek lengkap secepatnya (bergiliran). */
async function bulkStatus(usernames, queue = false) {
  if (!ST_TOKEN) return { error: 'no_token' };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    const r = await fetch(`${ST_URL}/api/admin/pantau-status`, {
      method: 'POST', headers: { 'x-admin-token': ST_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ usernames, queue }), signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'waktu habis' : e.message };
  }
}

const ago = (ts) => {
  if (!ts) return 'belum pernah';
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  return m < 60 ? `${m} mnt lalu` : m < 48 * 60 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`;
};

function fmtBulk(all, res) {
  const acc = res.accounts || {};
  const restricted = all.filter((u) => acc[u]?.verdict === 'RESTRICTED');
  const gone = all.filter((u) => ['SUSPENDED', 'NOT_FOUND', 'UNAVAILABLE', 'PROTECTED', 'NO_TWEETS'].includes(acc[u]?.verdict));
  const pending = all.filter((u) => acc[u]?.status === 'ok' && !acc[u]?.verdict);
  const missing = all.filter((u) => acc[u]?.status !== 'ok');
  const clear = all.filter((u) => acc[u]?.verdict === 'CLEAR');
  const lines = [`*Akun konten dipantau: ${all.length}*`, `✅ Aman: ${clear.length} · ⚠️ Terbatas: ${restricted.length} · ⛔ Tidak tersedia: ${gone.length} · ⏳ Belum dicek: ${pending.length + missing.length}`];
  if (restricted.length) lines.push('', '⚠️ *Terbatas:*', ...restricted.map((u) => `• @${u} — ${(acc[u].banned || []).map((k) => TEST_LABEL[k] || k).join(', ') || 'pembatasan'} (cek ${ago(acc[u].last_full)})`));
  if (gone.length) lines.push('', '⛔ *Tidak tersedia:*', ...gone.map((u) => `• @${u} — ${VERDICT_TEXT[acc[u].verdict]?.replace(/^\S+\s/, '') || acc[u].verdict}`));
  if (missing.length) lines.push('', `⏳ Belum masuk daftar SinyalTren: ${missing.map((u) => '@' + u).join(', ')}`);
  return lines.join('\n');
}

function fmtCheck(u, r) {
  if (r.status === 'not_monitored') return `@${u}\n_Belum masuk daftar pantau SinyalTren (daftar disinkronkan berkala). Coba lagi ±10 menit lagi._`;
  if (r.status === 'no_token') return `@${u}\n_SinyalTren belum tersambung ke bot (SINYALTREN_TOKEN kosong)._`;
  if (r.status !== 'ok') return `@${u}\n_⚠️ Gagal dicek${r.code ? ` (${r.code})` : ''}. Coba lagi nanti._`;
  const lines = [`@${u}`, VERDICT_TEXT[r.verdict] || `Status: ${r.verdict}`];
  for (const [k, v] of Object.entries(r.tests || {})) lines.push(`${STATUS_ICON[v.status] || '•'} ${TEST_LABEL[k] || k}${v.status === 'unknown' ? ' (belum pasti)' : ''}`);
  if (r.cached) lines.push('_Hasil cek <30 menit lalu (dipakai ulang)._');
  return lines.join('\n');
}

export async function isCommunity(sock, who) {
  return Boolean((await findMember(sock, who).catch(() => null)) || (await findCommunityMember(sock, who)));
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, command, prefix, isGroup, pushName } = messageInfo;
  const send = (text) => sock.sendMessage(remoteJid, { text }, { quoted: message });
  const p = prefix || '.';
  try {
    const args = (content || '').trim();
    if (isGroup) {
      // Demi privasi, pendaftaran hanya lewat chat pribadi. Pesan berisi username dihapus bila bot admin grup.
      if (args && args.toLowerCase() !== 'semua') {
        try { await sock.sendMessage(remoteJid, { delete: message.key }); } catch {}
      }
      return send(`🔒 Demi privasi, akun konten didaftarkan lewat *chat pribadi ke bot*, bukan di grup.\nKetik di chat pribadi: *${p}pantau usernamemu*`);
    }
    const who = await whoIs(sock, messageInfo);
    const member = (await findMember(sock, who).catch(() => null)) || (await findCommunityMember(sock, who));
    if (!member) return send('_🔔 Pantau akun konten khusus anggota grup komunitas Panjenengan._');
    const data = store.load();

    if (command === 'unpantau') {
      const list = store.mine(data, who);
      const toks = args.split(/[\s,;]+/).filter(Boolean);
      if (!toks.length) return send(`Ketik *${p}unpantau* + nomor atau username.\nContoh: *${p}unpantau 1*\n\nAkunmu:\n` + (list.map((a, i) => `${i + 1}. @${a.username}`).join('\n') || '-'));
      const names = toks.map((t) => (/^\d+$/.test(t) ? list[Number(t) - 1]?.username : store.parseUsernames(t).ok[0])).filter(Boolean);
      const admin = await isMgAdmin(sock, messageInfo, who).catch(() => false);
      const r = store.remove(who, names, admin);
      return send((r.removed.length ? `🗑️ Berhenti dipantau: ${r.removed.map((u) => '@' + u).join(', ')}` : '_Tidak ada akun yang dihapus._') +
        (r.notMine.length ? `\n⚠️ Bukan akunmu: ${r.notMine.map((u) => '@' + u).join(', ')}` : ''));
    }

    if (/^cek\s+semua$/i.test(args)) {
      // (admin) jadwalkan cek lengkap SEMUA akun pantau lewat antrean SinyalTren (bergiliran, hemat akun X)
      if (!(await isMgAdmin(sock, messageInfo, who).catch(() => false))) return send('_Hanya admin._');
      const all = Object.keys(data.accounts).sort();
      if (!all.length) return send('_Belum ada akun yang dipantau._');
      const res = await bulkStatus(all, true);
      if (res.error) return send(res.error === 'no_token' ? '_SinyalTren belum tersambung ke bot (SINYALTREN_TOKEN kosong)._' : `_⚠️ SinyalTren tidak bisa dihubungi (${res.error})._`);
      if (!res.enabled) return send('_⚠️ Pantau di SinyalTren sedang mati (MONITOR_ENABLED=0), antrean tidak akan berjalan._');
      const eta = Math.ceil((res.waiting * ((res.gap_sec || 75) + 60)) / 60);
      return send(`🔁 *Cek ulang semua akun pantau dijadwalkan*\n${res.queued} akun baru masuk antrean, total menunggu ${res.waiting} akun.\nCek berjalan bergiliran (1 akun tiap ±${(res.gap_sec || 75) + 60} detik), perkiraan selesai ±${eta >= 90 ? Math.round(eta / 60) + ' jam' : eta + ' menit'}.\n\nPemilik akun dapat kabar kalau statusnya berubah. Lihat rekap kapan saja: *${p}pantau semua*`);
    }

    if (/^cek\b/i.test(args)) {
      // .pantau cek            -> cek lengkap sekarang semua akunmu (maks. 5)
      // .pantau cek user1 …    -> akun tertentu (milikmu; admin boleh akun siapa pun)
      const admin = await isMgAdmin(sock, messageInfo, who).catch(() => false);
      const mineList = store.mine(data, who).map((a) => a.username);
      const asked = store.parseUsernames(args.replace(/^cek\b/i, '')).ok;
      let names = asked.length ? asked : mineList;
      const notMine = admin ? [] : names.filter((u) => !mineList.includes(u));
      names = names.filter((u) => admin || mineList.includes(u)).filter((u) => data.accounts[u]);
      const notListed = asked.filter((u) => !data.accounts[u]);
      if (!names.length) {
        return send((mineList.length ? '' : `Kamu belum memantau akun apa pun. Daftarkan dulu: *${p}pantau usernamemu*\n`) +
          (notMine.length ? `⚠️ Bukan akunmu: ${notMine.map((u) => '@' + u).join(', ')}\n` : '') +
          (notListed.length ? `⚠️ Belum dipantau: ${notListed.map((u) => '@' + u).join(', ')}` : ''));
      }
      const more = names.length > 5 ? names.length - 5 : 0;
      names = names.slice(0, 5);
      await send(`⏳ Mengecek ${names.length} akun sekarang (±1–2 menit per akun)…${more ? `\n_${more} akun lain tidak ikut; cek dengan *${p}pantau cek username*._` : ''}`);
      for (const u of names) await send(fmtCheck(u, await checkNow(u)));
      if (notMine.length) await send(`⚠️ Tidak dicek, bukan akunmu: ${notMine.map((u) => '@' + u).join(', ')}`);
      return null;
    }

    if (args.toLowerCase() === 'semua') {
      if (!(await isMgAdmin(sock, messageInfo, who).catch(() => false))) return send('_Hanya admin._');
      const all = Object.keys(data.accounts).sort();
      const res = all.length ? await bulkStatus(all, false) : { accounts: {} };
      if (res.error) return send(`*Akun konten dipantau: ${all.length}/${store.MAX_TOTAL}*\n` + (all.map((u) => '@' + u).join(', ') || '-') + `\n\n_Status dari SinyalTren tidak bisa diambil (${res.error === 'no_token' ? 'SINYALTREN_TOKEN kosong' : res.error})._`);
      return send(fmtBulk(all, res) + `\n\n_Cek ulang semua: *${p}pantau cek semua* · satu akun: *${p}pantau cek username*_`);
    }

    if (!args) {
      const list = store.mine(data, who);
      // sesi lain jangan sampai menangkap username yang dikirim berikutnya
      clearKiwSession(messageInfo);
      closeSession(messageInfo);
      store.openSession(messageInfo);
      return send(
        '🔔 *Pantau Shadowban — akun konten*\n\n' +
        (list.length ? `Akun yang kamu pantau (${list.length}/${store.MAX_PER_MEMBER}):\n` + list.map((a, i) => `${i + 1}. @${a.username}`).join('\n') + '\n\n' : '') +
        `Kirim *username akun konten* yang mau dipantau sekarang, pisahkan dengan spasi atau baris baru (maks. ${store.MAX_PER_MEMBER} akun).\n` +
        'Contoh:\nakunkonten1\nakunkonten2\n\n' +
        `_Ketik langsung tanpa titik. Ketik *batal* untuk membatalkan. Sesi 10 menit._\nHapus akun: *${p}unpantau 1* · Cek sekarang: *${p}pantau cek*`,
      );
    }

    return send(await registerPantau(messageInfo, who, args, p));
  } catch (e) {
    console.error('[pantau]', e.message);
    return send('_⚠️ Fitur pantau sedang bermasalah, coba lagi nanti._');
  }
}

export default {
  handle,
  Commands: ['pantau', 'unpantau'],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 0,
};
