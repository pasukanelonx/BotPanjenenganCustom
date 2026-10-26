// Sambung Kata (Skata) di grup. Logika di lib/skataGame.js, jawaban tanpa titik ditangani handle/GAMES/skata.js
import * as sk from '../../lib/skataGame.js';
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

async function handle(sock, messageInfo) {
  sk.setSock(sock);
  const { remoteJid, message, content, isGroup } = messageInfo;
  const reply = (text, mentions = []) => sock.sendMessage(remoteJid, { text, mentions }, { quoted: message });
  if (!isGroup) return reply('🔤 Sambung Kata dimainkan di grup. Ketik *.skata* di grup untuk membuat atau ikut lobi.');
  const sub = (content || '').trim().toLowerCase().split(/\s+/)[0] || '';
  const mentionsOf = (g) => (g ? g.players.map((p) => p.mention) : []);

  if (['mulai', 'start'].includes(sub)) {
    const r = await sk.start(messageInfo);
    if (r.err) return reply(r.err);
    return;
  }
  if (['keluar', 'leave', 'out'].includes(sub)) {
    const r = await sk.leave(messageInfo);
    if (r.err || r.msg) return reply(r.err || r.msg);
    return;
  }
  if (['stop', 'berhenti', 'bubar'].includes(sub)) {
    const r = await sk.stop(messageInfo, await isGroupAdmin(sock, messageInfo));
    return reply(r.err || r.msg);
  }
  if (['status', 'info'].includes(sub)) {
    const g = sk.getGame(remoteJid);
    return reply(sk.statusText(remoteJid), mentionsOf(g));
  }
  if (['aturan', 'rules', 'help', 'bantuan'].includes(sub)) {
    return reply(`🔤 *S A M B U N G - K A T A*\n\n${sk.RULES}\n\n*.skata* — buat/ikut lobi\n*.skata mulai* — mulai (pembuat lobi)\n*.skata keluar* · *.skata status* · *.skata stop*`);
  }
  // .skata (tanpa sub) atau .skata join → buat/ikut lobi
  const r = sk.joinOrCreate(messageInfo);
  if (r.err) return reply(r.err);
  const head = r.created ? `🔤 *S A M B U N G - K A T A*\n\n${sk.RULES}\n\n` : '';
  return reply(head + sk.lobbyText(r.g), mentionsOf(r.g));
}

export default {
  handle,
  Commands: ['skata', 'sambungkata'],
  OnlyPremium: false,
  OnlyOwner: false,
};
