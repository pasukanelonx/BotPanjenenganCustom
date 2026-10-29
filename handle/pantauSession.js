// Sesi .pantau: setelah member mengetik ".pantau" (tanpa username) di chat pribadi,
// pesan berikutnya (tanpa titik) dianggap daftar username akun konten.
import * as store from '../lib/pantauStore.js';
import { whoIs } from '../lib/memberGuard.js';
import { registerPantau, isCommunity } from '../plugins/AKUN X/pantau.js';

async function process(sock, messageInfo) {
  try {
    const { isGroup, fromMe, prefix, fullText, remoteJid, message } = messageInfo;
    if (isGroup || fromMe || prefix || !fullText) return true;
    if (!store.hasSession(messageInfo)) return true;
    const text = fullText.trim();
    store.closeSession(messageInfo);
    if (/^(batal|selesai|cancel)$/i.test(text)) {
      await sock.sendMessage(remoteJid, { text: 'Pendaftaran pantau dibatalkan.' }, { quoted: message });
      return false;
    }
    const who = await whoIs(sock, messageInfo);
    if (!(await isCommunity(sock, who))) return true;
    const reply = await registerPantau(messageInfo, who, text, '.');
    await sock.sendMessage(remoteJid, { text: reply }, { quoted: message });
    return false; // sudah ditangani
  } catch (e) {
    console.error('[pantau] sesi:', e.message);
    return true;
  }
}

export default {
  name: 'Pantau Session',
  priority: 5, // setelah KiwSession (1) dan Member Guard (4)
  process,
};
