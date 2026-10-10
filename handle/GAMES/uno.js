// Langkah UNO tanpa titik ("3", "4 merah", "ambil", "lewat", "uno", "tangkap"), dari grup maupun chat pribadi.
// Hanya diproses kalau pengirimnya pemain UNO yang sedang berjalan; selain itu diteruskan ke handler lain.
import * as uno from '../../lib/unoGame.js';

async function process(sock, messageInfo) {
  try {
    uno.setSock(sock);
    if (messageInfo.fromMe) return true;
    const text = String(messageInfo.fullText || messageInfo.content || '').trim();
    if (!text || text.length > 20 || /^[.!#/]/.test(text)) return true;
    const r = await uno.move(messageInfo, text);
    if (!r.handled) return true;
    if (r.reply) await sock.sendMessage(messageInfo.remoteJid, { text: r.reply }, { quoted: messageInfo.message });
    return false; // sudah ditangani
  } catch (e) {
    console.error('[uno] handler:', e.message);
    return true;
  }
}

export const name = 'UNO';
export const priority = 5;
export { process };
