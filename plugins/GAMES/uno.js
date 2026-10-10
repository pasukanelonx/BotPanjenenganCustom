// Game UNO di grup WhatsApp. Logika ada di lib/unoGame.js, langkah tanpa titik ditangani handle/GAMES/uno.js
import * as uno from '../../lib/unoGame.js';

function helpText(p) {
  return (
    `🎴 *UNO*\n\n` +
    `*${p}uno buat* — buat lobi\n` +
    `*${p}uno join* — ikut lobi\n` +
    `*${p}uno mulai* — mulai (pembuat lobi, min. 2 pemain)\n` +
    `*${p}uno kartu* — kirim ulang kartumu ke chat pribadi\n` +
    `*${p}uno status* — lihat meja\n` +
    `*${p}uno keluar* — keluar dari game\n` +
    `*${p}uno stop* — hentikan game (pembuat / admin)\n\n` +
    `*Saat main* (tanpa titik, di grup atau chat bot):\n` +
    `• *3* — mainkan kartu nomor 3\n` +
    `• *4 merah* — Wild/+4 nomor 4, pilih warna (merah/biru/hijau/kuning)\n` +
    `• *ambil* — ambil 1 kartu · *lewat* — lewati setelah ambil\n` +
    `• *uno* — saat kartu tinggal 2/1 · *tangkap* — tangkap yang lupa UNO (+2)\n\n` +
    `Kartu: angka, Skip, Reverse, +2, Wild, Wild +4 (tidak bisa ditumpuk).\n` +
    `Waktu per giliran 60 detik; 3x tidak main = dikeluarkan.`
  );
}

async function handle(sock, messageInfo) {
  uno.setSock(sock);
  const { remoteJid, message, content, isGroup, prefix } = messageInfo;
  const p = prefix || '.';
  const reply = (text) => sock.sendMessage(remoteJid, { text }, { quoted: message });
  const sub = (content || '').trim().toLowerCase().split(/\s+/)[0] || '';

  if (sub === 'kartu') {
    const r = await uno.resendHand(messageInfo);
    return reply(r.err || r.msg);
  }
  if (!isGroup) {
    return reply(`🎴 UNO dimainkan di grup. Buat lobi di grup: *${p}uno buat*.\nSaat giliranmu, kamu bisa main dari chat ini dengan ketik nomor kartu.\nKirim ulang kartu: *${p}uno kartu*`);
  }

  if (['buat', 'create', 'new', 'baru'].includes(sub)) {
    let groupName = '';
    try { groupName = (await sock.groupMetadata(remoteJid))?.subject || ''; } catch {}
    const r = uno.createLobby(messageInfo, groupName);
    if (r.err) return reply(r.err);
    return reply(uno.statusText(remoteJid) + `\n\n_Lobi batal otomatis kalau tidak dimulai dalam 5 menit._`);
  }
  if (['join', 'ikut', 'gabung'].includes(sub)) {
    const r = uno.joinLobby(messageInfo);
    return reply(r.err || uno.statusText(remoteJid));
  }
  if (['mulai', 'start'].includes(sub)) {
    const r = await uno.startGame(messageInfo);
    if (r.err) return reply(r.err);
    return;
  }
  if (['keluar', 'leave', 'out'].includes(sub)) {
    const r = await uno.leave(messageInfo);
    if (r.err || r.msg) return reply(r.err || r.msg);
    return;
  }
  if (['stop', 'berhenti', 'bubar'].includes(sub)) {
    let isAdmin = false;
    try {
      const ids = uno.idsOf(messageInfo);
      const meta = await sock.groupMetadata(remoteJid);
      isAdmin = (meta?.participants || []).some((x) => x.admin && [x.id, x.lid, x.phoneNumber, x.jid].filter(Boolean).map(uno.normJid).some((j) => ids.includes(j)));
    } catch {}
    const r = await uno.stopGame(messageInfo, isAdmin);
    return reply(r.err || r.msg);
  }
  if (['status', 'meja', 'info'].includes(sub)) {
    const g = uno.getGame(remoteJid);
    return sock.sendMessage(remoteJid, { text: uno.statusText(remoteJid), mentions: g ? g.players.map((x) => x.mention) : [] }, { quoted: message });
  }
  return reply(helpText(p) + '\n\n' + uno.statusText(remoteJid));
}

export default {
  handle,
  Commands: ['uno'],
  OnlyPremium: false,
  OnlyOwner: false,
};
