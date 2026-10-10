// Pendataan akun X oleh member, lewat chat pribadi dengan bot.
import { mg, whoIs, openSession, registerFromText } from '../../lib/memberGuard.js';

const ONLY_PRIVATE = '_⚠️ Pendataan akun X dilakukan lewat *chat pribadi* ke bot ini._';

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, command, prefix, isGroup } = messageInfo;
  const send = (text) => sock.sendMessage(remoteJid, { text }, { quoted: message });
  try {
    if (isGroup) return send(ONLY_PRIVATE);
    const { core, util } = await mg();
    const args = (content || '').trim();

    if (command === 'daftar') {
      if (!args) {
        openSession(messageInfo);
        return send(
          '*Pendataan Akun X*\n\n' +
          'Kirim *semua username akun X milikmu* sekarang, pisahkan dengan spasi atau baris baru.\n' +
          'Boleh pakai @ atau link profil x.com.\n\n' +
          'Contoh:\nakunsatu\nakundua\n\n' +
          '_Ketik langsung tanpa titik. Ketik *batal* untuk membatalkan. Sesi 10 menit._',
        );
      }
      return send(await registerFromText(sock, messageInfo, args));
    }

    const who = await whoIs(sock, messageInfo);
    const owner = await core.findOwner(who);

    const st = { ada: '✅ ada di grup DM', hilang: '❌ tidak terlihat di grup DM', baru: '⏳ belum dicek' };
    const accs = owner ? await core.ownerAccounts(owner.id) : [];
    const daftarBernomor = () => accs.map((a, i) => `${i + 1}. @${a.username} — ${st[a.state] || a.state}`).join('\n');

    if (command === 'akunku') {
      if (!accs.length) return send(`Belum ada akun X terdaftar. Daftar dengan *${prefix}daftar*`);
      return send(`*Akun X milikmu (${accs.length})*\n` + daftarBernomor() +
        `\n\nTambah: *${prefix}daftar*\nHapus: *${prefix}hapusakun 2* (pakai nomor di atas, boleh beberapa: *${prefix}hapusakun 1 3*)`);
    }

    if (command === 'hapusakun') {
      if (!owner || !accs.length) return send('Kamu belum punya akun terdaftar.');
      const toks = args.split(/[\s,;]+/).filter(Boolean);
      if (!toks.length) {
        return send(`*Hapus akun X*\n${daftarBernomor()}\n\nKetik *${prefix}hapusakun* + nomornya.\nContoh: *${prefix}hapusakun 2* atau *${prefix}hapusakun 1 3*`);
      }
      const hasil = [];
      const sudah = new Set();
      for (const t of toks) {
        let u;
        if (/^\d+$/.test(t)) {
          const a = accs[Number(t) - 1];
          if (!a) { hasil.push(`⚠️ Nomor ${t} tidak ada (pilih 1–${accs.length})`); continue; }
          u = a.username;
        } else u = util.normUser(t);
        if (!u || sudah.has(u)) continue;
        sudah.add(u);
        const ok = await core.removeAccount(u, owner.id);
        if (ok) await core.log(who.pn || who.lid, 'hapus', u);
        hasil.push(ok ? `🗑️ @${u} dihapus` : `⚠️ @${u} bukan akun terdaftarmu`);
      }
      const sisa = (await core.ownerAccounts(owner.id)).length;
      return send(hasil.join('\n') + `\n\nSisa akunmu: ${sisa}. Cek dengan *${prefix}akunku*`);
    }
  } catch (e) {
    console.error('[member-guard] akunx:', e.message);
    return send('_⚠️ Pendataan sedang bermasalah, coba lagi nanti atau hubungi admin._');
  }
}

export default {
  handle,
  Commands: ['daftar', 'akunku', 'hapusakun'],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 0,
};
