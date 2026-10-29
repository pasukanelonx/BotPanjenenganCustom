// Pantau akun konten (akun untuk upload postingan) oleh SinyalTren. Semua lewat CHAT PRIBADI (privasi):
// .pantau                → lihat akun konten yang kamu pantau + cara pakai
// .pantau user1 user2 …  → tambah (maks. PANTAU_MAX_PER_MEMBER akun per member, bawaan 5)
// .unpantau 2 / username → berhenti memantau
// .pantau semua          → (admin) jumlah & daftar akun yang dipantau
// Syarat: anggota grup member / komunitas. Notifikasi perubahan status dikirim lewat chat pribadi.
// Username dicek ke X lewat SinyalTren (SINYALTREN_URL + SINYALTREN_TOKEN = ADMIN_TOKEN SinyalTren) bila diatur.
import { whoIs, findMember, findCommunityMember, isMgAdmin } from '../../lib/memberGuard.js';
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

    if (args.toLowerCase() === 'semua') {
      if (!(await isMgAdmin(sock, messageInfo, who).catch(() => false))) return send('_Hanya admin._');
      const all = Object.keys(data.accounts).sort();
      return send(`*Akun konten dipantau: ${all.length}/${store.MAX_TOTAL}*\n` + (all.map((u) => '@' + u).join(', ') || '-'));
    }

    if (!args) {
      const list = store.mine(data, who);
      return send(
        '🔔 *Pantau Shadowban — akun konten*\n\n' +
        (list.length ? `Akun yang kamu pantau (${list.length}/${store.MAX_PER_MEMBER}):\n` + list.map((a, i) => `${i + 1}. @${a.username}`).join('\n') : 'Kamu belum memantau akun apa pun.') +
        `\n\nTambah: *${p}pantau akun1 akun2* (boleh sekaligus, maks. ${store.MAX_PER_MEMBER})\nHapus: *${p}unpantau 1*\n\n` +
        '_SinyalTren mengecek akunmu setiap hari (cek lengkap tiap minggu). Kalau terdeteksi shadowban atau sudah pulih, kabarnya dikirim ke chat ini._',
      );
    }

    const { ok, bad } = store.parseUsernames(args);
    if (!ok.length) return send(`Tulis username akun X-nya, boleh beberapa sekaligus.\nContoh: *${p}pantau akunkonten1 akunkonten2*` + (bad.length ? `\n\n⚠️ Bukan username valid: ${bad.join(', ')}` : ''));

    // Cek ke X: username salah ketik / tidak ada / suspend / dikunci langsung ketahuan
    const fresh = ok.filter((u) => !data.accounts[u]);
    const cek = await checkX(fresh.slice(0, 10));
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
    const r = store.add(who, pushName, accept);
    const lines = [];
    if (r.added.length) lines.push(`✅ *Mulai dipantau:* ${r.added.map((u) => '@' + u).join(', ')}\n_Cek pertama berjalan dalam ±1 hari (bergiliran). Kabarnya dikirim ke chat ini._`);
    if (r.already.length) lines.push(`ℹ️ Sudah kamu pantau: ${r.already.map((u) => '@' + u).join(', ')}`);
    if (r.taken.length) lines.push(`⚠️ Sudah dipantau member lain: ${r.taken.map((u) => '@' + u).join(', ')} (hubungi admin kalau itu akunmu)`);
    if (r.full.length) lines.push(`⚠️ Tidak ditambahkan (batas ${store.MAX_PER_MEMBER} akun per member, atau kuota penuh): ${r.full.map((u) => '@' + u).join(', ')}`);
    if (rejected.length) lines.push(`❌ *Tidak bisa dipantau:*\n${rejected.map((x) => '• ' + x).join('\n')}`);
    if (bad.length) lines.push(`⚠️ Bukan username valid: ${bad.join(', ')}`);
    if (!cek && r.added.length) lines.push('_Username belum bisa dicek ke X sekarang; kalau salah ketik, akan ketahuan saat cek pertama._');
    return send(lines.join('\n\n') || '_Tidak ada perubahan._');
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
