import { processKiwSession } from '../plugins/GROUP/kiw.js';
import { getKiwSession } from '../lib/kiwSession.js';

export default {
  name: 'kiwSession',
  priority: 10, // lebih awal dari handler lain
  async process(sock, messageInfo) {
    try {
      const { sender, isGroup, fromMe } = messageInfo;

      // Abaikan grup & pesan dari bot sendiri
      if (isGroup) return;
      if (fromMe) return;
      if (!sender) return;

      // Hanya jika user sedang dalam session kiw
      const sess = getKiwSession(sender);
      if (!sess) return;

      // Proses langkah session (username / pilih grup / lapor / menu)
      const handled = await processKiwSession(sock, messageInfo);

      // true = sudah ditangani → hentikan ke plugin
      // (di Resbot biasanya return false = stop; sesuaikan jika terbalik)
      if (handled) {
        return false;
      }
    } catch (e) {
      console.error('kiwSession handler:', e.message);
    }
  },
};