// Handler member-guard:
// 1. menyimpan socket aktif agar laporan dari member-guard bisa dikirim ke grup admin;
// 2. menangkap username akun X yang dikirim member setelah mengetik .daftar (tanpa prefix).
import { rememberSock, hasSession, closeSession, registerFromText } from '../lib/memberGuard.js';

async function process(sock, messageInfo) {
  try {
    rememberSock(sock);
    const { isGroup, fromMe, prefix, fullText, remoteJid, message } = messageInfo;
    if (isGroup || fromMe || prefix || !fullText) return true;
    if (!hasSession(messageInfo)) return true;

    const text = fullText.trim();
    if (/^(batal|selesai|cancel)$/i.test(text)) {
      closeSession(messageInfo);
      await sock.sendMessage(remoteJid, { text: 'Pendaftaran dibatalkan.' }, { quoted: message });
      return false;
    }
    closeSession(messageInfo);
    const reply = await registerFromText(sock, messageInfo, text);
    await sock.sendMessage(remoteJid, { text: reply }, { quoted: message });
    return false; // berhenti: pesan ini sudah ditangani
  } catch (e) {
    console.error('[member-guard] handler:', e.message);
    return true;
  }
}

export default {
  name: 'Member Guard',
  priority: 4, // setelah KiwSession (1) dan usersHandle (3: cek ban/block)
  process,
};
