// Pantau akun konten (akun untuk upload postingan) oleh SinyalTren, notifikasi ke grup pantau WA.
// .pantau                → lihat akun yang kamu pantau + cara pakai
// .pantau user1 user2    → tambah (maks. PANTAU_MAX_PER_MEMBER akun per member)
// .unpantau 2 / username → berhenti memantau
// .pantau semua          → (admin) jumlah & daftar akun yang dipantau
// Semua perintah dipakai lewat chat pribadi (khusus anggota grup pantau), demi privasi.
import { whoIs, groupMeta, matchP, isMgAdmin } from '../../lib/memberGuard.js';
import * as store from '../../lib/pantauStore.js';

const groupJid = () => (process.env.PANTAU_GROUP_JID || '').trim();

async function inPantauGroup(sock, who) {
  const jid = groupJid();
  if (!jid) return false;
  try {
    const meta = await groupMeta(sock, jid);
    return (meta?.participants || []).some((p) => matchP(p, who));
  } catch {
    return false;
  }
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, command, prefix, isGroup, pushName } = messageInfo;
  const send = (text, mentions) => sock.sendMessage(remoteJid, { text, ...(mentions ? { mentions } : {}) }, { quoted: message });
  const p = prefix || '.';
  try {
    if (!groupJid()) return send('_⚠️ Fitur pantau belum diatur admin (PANTAU_GROUP_JID kosong)._');
    const who = await whoIs(sock, messageInfo);
    const args = (content || '').trim();
    if (isGroup) {
      // Demi privasi, pendaftaran hanya lewat chat pribadi. Pesan berisi username dihapus bila bot admin grup.
      if (args && args.toLowerCase() !== 'semua') {
        try { await sock.sendMessage(remoteJid, { delete: message.key }); } catch {}
      }
      return send('🔒 Demi privasi, daftarkan akun konten lewat *chat pribadi ke bot*, bukan di grup.\nKetik di chat pribadi: *' + p + 'pantau usernamemu*');
    }
    if (!(await inPantauGroup(sock, who))) {
      return send('_🔔 Pantau akun konten khusus untuk anggota *grup Pantau Shadowban*. Gabung dulu ke grup itu (minta link ke admin), lalu ketik lagi di sini._');
    }
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
        `\n\nTambah: *${p}pantau usernamemu* (boleh beberapa, maks. ${store.MAX_PER_MEMBER})\nHapus: *${p}unpantau 1*\n\n` +
        '_SinyalTren mengecek akunmu setiap hari (cek lengkap tiap minggu). Kalau terdeteksi shadowban atau sudah pulih, kamu di-mention di grup ini._',
      );
    }

    const { ok, bad } = store.parseUsernames(args);
    if (!ok.length) return send(`Tulis username akun X-nya.\nContoh: *${p}pantau akunkonten*`);
    const r = store.add(who, pushName, ok);
    const lines = [];
    if (r.added.length) lines.push(`✅ Mulai dipantau: ${r.added.map((u) => '@' + u).join(', ')}\n_Cek pertama berjalan dalam ±1 hari (bergiliran)._`);
    if (r.already.length) lines.push(`ℹ️ Sudah kamu pantau: ${r.already.map((u) => '@' + u).join(', ')}`);
    if (r.taken.length) lines.push(`⚠️ Sudah dipantau member lain: ${r.taken.map((u) => '@' + u).join(', ')} (hubungi admin kalau itu akunmu)`);
    if (r.full.length) lines.push(`⚠️ Tidak ditambahkan (batas ${store.MAX_PER_MEMBER} akun per member atau kuota penuh): ${r.full.map((u) => '@' + u).join(', ')}`);
    if (bad.length) lines.push(`⚠️ Bukan username valid: ${bad.join(', ')}`);
    return send(lines.join('\n\n'));
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
