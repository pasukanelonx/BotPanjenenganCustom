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
  let m = message?.message || {};
  for (const w of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) {
    if (m[w]?.message) m = m[w].message;
  }
  for (const k of Object.keys(m)) {
    const id = m[k]?.contextInfo?.stanzaId;
    if (id) return id;
  }
  return null;
}

function mediaOf(message, key) {
  let m = message?.message || {};
  for (const w of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) {
    if (m[w]?.message) m = m[w].message;
  }
  return m[key] || {};
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
        type: rawType,
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

      const adminName = 'Admin';
      // PENTING: pakai teks mentah, bukan messageInfo.content
      const body = getRawText(message);
      let mm = message?.message || {};
      for (const w of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) if (mm[w]?.message) mm = mm[w].message;
      const type = ['sticker', 'audio', 'document', 'image', 'video'].find((t) => mm[t + 'Message']) || rawType;

      const header =
        `💬 *Balasan Admin*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `👤 Dari: Admin\n` +
        `━━━━━━━━━━━━━━━━\n`;

      if (['sticker', 'audio', 'document'].includes(type)) {
        try {
          const media = await downloadMedia(message);
          const buffer = fs.readFileSync(path.join('tmp', media));
          if (type === 'sticker') {
            await sock.sendMessage(ref.userJid, { sticker: buffer });
          } else if (type === 'audio') {
            const a = mediaOf(message, 'audioMessage');
            await sock.sendMessage(ref.userJid, { text: header.trim() });
            await sock.sendMessage(ref.userJid, { audio: buffer, mimetype: a.mimetype || 'audio/ogg; codecs=opus', ptt: !!a.ptt });
          } else {
            const d = mediaOf(message, 'documentMessage');
            await sock.sendMessage(ref.userJid, { document: buffer, mimetype: d.mimetype || 'application/octet-stream', fileName: d.fileName || 'file', caption: header + (body || '') });
          }
        } catch (e) {
          console.error('kiwAdminReply media:', e.message);
          await sock.sendMessage(remoteJid, { text: 'Gagal meneruskan ' + type + ': ' + e.message }, { quoted: message });
          return false;
        }
      } else if (type === 'image' || type === 'video') {
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