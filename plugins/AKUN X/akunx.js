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

    if (command === 'akunku') {
      const accs = owner ? await core.ownerAccounts(owner.id) : [];
      if (!accs.length) return send(`Belum ada akun X terdaftar. Daftar dengan *${prefix}daftar*`);
      const st = { ada: '✅ ada di grup DM', hilang: '❌ tidak terlihat di grup DM', baru: '⏳ belum dicek' };
      return send(`*Akun X milikmu (${accs.length})*\n` + accs.map((a) => `• @${a.username} — ${st[a.state] || a.state}`).join('\n') +
        `\n\nTambah: *${prefix}daftar*\nHapus: *${prefix}hapusakun username*`);
    }

    if (command === 'hapusakun') {
      const u = util.normUser(args.split(/\s+/)[0]);
      if (!u) return send(`Contoh: *${prefix}hapusakun namaakun*`);
      if (!owner) return send('Kamu belum punya akun terdaftar.');
      const ok = await core.removeAccount(u, owner.id);
      if (ok) await core.log(who.pn || who.lid, 'hapus', u);
      return send(ok ? `🗑️ @${u} dihapus dari daftarmu.` : `@${u} bukan akun terdaftarmu.`);
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
