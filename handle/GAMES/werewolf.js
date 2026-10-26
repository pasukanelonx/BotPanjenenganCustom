// Werewolf tanpa titik: aksi malam di chat pribadi ("3", "bunuh 3", "terawang 3", "lindungi 3")
// dan voting siang di grup ("vote 3"). Pesan lain diteruskan ke handler berikutnya.
import * as ww from '../../lib/werewolfGame.js';

async function process(sock, messageInfo) {
  try {
    ww.setSock(sock);
    if (messageInfo.fromMe) return true;
    const text = String(messageInfo.fullText || messageInfo.content || '').trim().toLowerCase();
    if (!text || text.length > 20 || /^[.!#/]/.test(text)) return true;
    let r = { handled: false };
    if (messageInfo.isGroup) {
      if (!ww.getGame(messageInfo.remoteJid)) return true;
      const m = text.match(/^vote\s*(\d{1,2})$/);
      if (m) r = await ww.vote(messageInfo, Number(m[1]));
    } else {
      const m = text.match(/^(?:bunuh|mangsa|terawang|lihat|lindungi|jaga|intip)?\s*(\d{1,2})$/);
      if (m) r = await ww.nightAction(messageInfo, Number(m[1]));
    }
    if (!r.handled) return true;
    if (r.reply) await sock.sendMessage(messageInfo.remoteJid, { text: r.reply }, { quoted: messageInfo.message });
    return false;
  } catch (e) {
    console.error('[ww] handler:', e.message);
    return true;
  }
}

export const name = 'WEREWOLF';
export const priority = 5;
export { process };
