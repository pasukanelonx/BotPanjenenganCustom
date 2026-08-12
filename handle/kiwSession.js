import { processKiwSession } from '../plugins/GROUP/kiw.js';
import { getKiwSession } from '../lib/kiwSession.js';

async function process(sock, messageInfo) {
  try {
    const { isGroup, fromMe } = messageInfo;

    if (isGroup) return true; // lanjut plugin lain
    if (fromMe) return true;

    // Cek session pakai sender / senderLid / remoteJid
    const sess = getKiwSession(messageInfo);
    if (!sess) return true;

    console.log('[kiwSession] aktif:', sess.mode, messageInfo.sender);

    const handled = await processKiwSession(sock, messageInfo);
    if (handled) {
      return false; // STOP — jangan lanjut ke plugin (tidak perlu .kiw lagi)
    }

    return true;
  } catch (e) {
    console.error('kiwSession handler:', e.message);
    return true;
  }
}

export default {
  name: 'KiwSession',
  priority: 1, // paling awal
  process,
};