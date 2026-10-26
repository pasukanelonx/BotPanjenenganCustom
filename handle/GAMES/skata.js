// Jawaban Sambung Kata tanpa titik. Hanya pesan dari pemain yang sedang giliran yang diproses;
// selain itu diteruskan ke handler lain sehingga obrolan grup tetap normal.
import * as sk from '../../lib/skataGame.js';

async function process(sock, messageInfo) {
  try {
    sk.setSock(sock);
    if (messageInfo.fromMe || !messageInfo.isGroup) return true;
    if (!sk.getGame(messageInfo.remoteJid)) return true;
    const text = String(messageInfo.fullText || messageInfo.content || '').trim();
    if (!text || text.length > 30 || /^[.!#/]/.test(text)) return true;
    const r = await sk.answer(messageInfo, text);
    if (!r.handled) return true;
    if (r.reply) await sock.sendMessage(messageInfo.remoteJid, { text: r.reply }, { quoted: messageInfo.message });
    return false;
  } catch (e) {
    console.error('[skata] handler:', e.message);
    return true;
  }
}

export const name = 'SKATA';
export const priority = 5;
export { process };
