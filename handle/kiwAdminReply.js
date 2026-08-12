import config from '../config.js';
import { getReportRef } from '../lib/kiwSession.js';
import { downloadMedia } from '../lib/utils.js';
import fs from 'fs';
import path from 'path';

/** Ambil teks mentah dari pesan WA (tidak lewat parser content Resbot) */
function getRawText(message) {
  const m = message?.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ''
  ).trim();
}

function getQuotedId(message) {
  const m = message?.message || {};
  const ctx =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.audioMessage?.contextInfo ||
    m.conversation?.contextInfo ||
    null;

  return ctx?.stanzaId || null;
}

export default {
  name: 'kiwAdminReply',
  priority: 15,
  async process(sock, messageInfo) {
    try {
      const {
        remoteJid,
        message,
        pushName,
        isGroup,
        type,
        fromMe,
      } = messageInfo;

      // Hanya di grup admin
      if (!isGroup) return;
      if (!config.group_laporan || remoteJid !== config.group_laporan) return;

      // Abaikan pesan bot sendiri
      if (fromMe) return;

      const quotedId = getQuotedId(message);
      if (!quotedId) return;

      const ref = getReportRef(quotedId);
      if (!ref || !ref.userJid) return;

      const adminName = pushName || 'Admin';
      // PENTING: pakai teks mentah, bukan messageInfo.content
      const body = getRawText(message);

      const header =
        `💬 *Balasan Admin*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `👤 Dari: ${adminName}\n` +
        `━━━━━━━━━━━━━━━━\n`;

      if (type === 'image' || type === 'video') {
        try {
          const media = await downloadMedia(message);
          const mediaPath = path.join('tmp', media);
          const buffer = fs.readFileSync(mediaPath);
          const caption = header + (body || '');

          if (type === 'video') {
            await sock.sendMessage(ref.userJid, { video: buffer, caption });
          } else {
            await sock.sendMessage(ref.userJid, { image: buffer, caption });
          }
        } catch (e) {
          console.error('kiwAdminReply media:', e.message);
          await sock.sendMessage(ref.userJid, {
            text: header + (body || '(media gagal dikirim)'),
          });
        }
      } else {
        if (!body) return;
        await sock.sendMessage(ref.userJid, {
          text: header + body,
        });
      }

      await sock.sendMessage(
        remoteJid,
        {
          text: `✅ Balasan diteruskan ke *${ref.userName || 'user'}*.`,
        },
        { quoted: message }
      );

      return false;
    } catch (e) {
      console.error('kiwAdminReply:', e.message);
    }
  },
};