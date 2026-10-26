// Werewolf di grup. Logika di lib/werewolfGame.js; aksi malam (DM) & "vote N" (grup) ditangani handle/GAMES/werewolf.js
import * as ww from '../../lib/werewolfGame.js';
import { idsOf, normJid } from '../../lib/unoGame.js';

async function isGroupAdmin(sock, mi) {
  try {
    const ids = idsOf(mi);
    const meta = await sock.groupMetadata(mi.remoteJid);
    return (meta?.participants || []).some((x) => x.admin && [x.id, x.lid, x.phoneNumber, x.jid].filter(Boolean).map(normJid).some((j) => ids.includes(j)));
  } catch {
    return false;
  }
}

function helpText() {
  return (
    `🐺 *W E R E W O L F*\n\n` +
    `Permainan tebak-tebakan sosial untuk 5–15 orang. Werewolf menyamar di antara warga; tiap malam mereka memangsa satu orang. ` +
    `Siang hari warga berdiskusi lalu voting untuk mengeksekusi yang dicurigai.\n\n` +
    `*Peran:* 🐺 Werewolf · 🧙 Penyihir (tim Werewolf, bisa intip peran) · 🔮 Penerawang (lihat peran) · 👼 Malaikat Pelindung (lindungi 1 orang) · 👨‍🌾 Warga\n\n` +
    `*.ww buat* — buat lobi\n*.ww join* — ikut\n*.ww mulai* — mulai (pembuat lobi)\n*.ww pemain* — daftar pemain & status\n` +
    `*.ww peran* — kirim ulang peran ke chat pribadi\n*.ww keluar* — keluar dari lobi\n*.ww stop* — hentikan (pembuat / admin)\n\n` +
    `*Saat main:* malam → ketik *nomor* target di chat pribadi bot · siang → ketik *vote nomor* di grup.\n` +
    `Warga menang kalau semua tim Werewolf mati; Werewolf menang kalau jumlahnya menyamai sisa warga.`
  );
}

async function handle(sock, messageInfo) {
  ww.setSock(sock);
  const { remoteJid, message, content, isGroup } = messageInfo;
  const reply = (text, mentions = []) => sock.sendMessage(remoteJid, { text, mentions }, { quoted: message });
  const args = (content || '').trim().toLowerCase().split(/\s+/);
  const sub = args[0] || '';
  const mentionsOf = (g) => (g ? g.players.map((p) => p.mention) : []);

  if (sub === 'peran' || sub === 'role') {
    const r = await ww.resendRole(messageInfo);
    return reply(r.err || r.msg);
  }
  if (!isGroup) return reply('🐺 Werewolf dimainkan di grup: *.ww buat*. Aksi malam diketik di chat ini dengan nomor pemain.');

  if (['buat', 'create', 'baru'].includes(sub)) {
    let groupName = '';
    try { groupName = (await sock.groupMetadata(remoteJid))?.subject || ''; } catch {}
    const r = ww.create(messageInfo, groupName);
    if (r.err) return reply(r.err);
    return reply(ww.lobbyText(r.g), mentionsOf(r.g));
  }
  if (['join', 'ikut', 'gabung'].includes(sub)) {
    const r = ww.join(messageInfo);
    if (r.err) return reply(r.err);
    return reply(ww.lobbyText(r.g), mentionsOf(r.g));
  }
  if (['mulai', 'start'].includes(sub)) {
    const r = await ww.start(messageInfo);
    if (r.err) return reply(r.err);
    return;
  }
  if (sub === 'vote' && /^\d{1,2}$/.test(args[1] || '')) {
    const r = await ww.vote(messageInfo, Number(args[1]));
    return reply(r.handled ? r.reply : 'Voting belum dibuka.');
  }
  if (['keluar', 'leave', 'exit'].includes(sub)) {
    const r = await ww.leave(messageInfo);
    return reply(r.err || r.msg);
  }
  if (['stop', 'hapus', 'delete', 'bubar'].includes(sub)) {
    const r = await ww.stop(messageInfo, await isGroupAdmin(sock, messageInfo));
    return reply(r.err || r.msg);
  }
  if (['pemain', 'player', 'status', 'info'].includes(sub)) {
    const g = ww.getGame(remoteJid);
    return reply(ww.statusText(remoteJid), mentionsOf(g));
  }
  return reply(helpText() + '\n\n' + ww.statusText(remoteJid));
}

export default {
  handle,
  Commands: ['ww', 'werewolf'],
  OnlyPremium: false,
  OnlyOwner: false,
};
