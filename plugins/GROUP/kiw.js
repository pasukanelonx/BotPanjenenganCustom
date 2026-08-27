import config from '../../config.js';
import moment from 'moment-timezone';
import fs from 'fs';
import path from 'path';
import { downloadQuotedMedia, downloadMedia } from '../../lib/utils.js';
import { logCustom } from '../../lib/logger.js';
import {
  setKiwSession,
  getKiwSession,
  clearKiwSession,
  saveReportRef,
  clearReportRefsByUser,
} from '../../lib/kiwSession.js';

const JOIN_CHAT_TTL = 10 * 60 * 1000;

function getRawText(message) {
  const m = message?.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  ).trim();
}

function getSessionText(messageInfo) {
  let text = getRawText(messageInfo.message);
  if (!text) text = (messageInfo.content || '').trim();
  text = text.replace(/^\s*[.!#]?kiw\b\s*/i, '').trim();
  return text;
}

async function resolveNomorWa(sock, messageInfo) {
  const { sender, senderPn, participantPn, message, remoteJid } = messageInfo;

  const candidates = [
    senderPn,
    participantPn,
    message?.key?.senderPn,
    message?.key?.participantPn,
    message?.key?.participantAlt,
    message?.key?.remoteJidAlt,
    remoteJid?.endsWith?.('@s.whatsapp.net') ? remoteJid : null,
    message?.participant,
    sender,
  ].filter(Boolean);

  for (const jid of candidates) {
    const id = String(jid);
    if (id.includes('@lid')) continue;
    const num = id.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (num.length >= 10 && num.length <= 15) return num;
  }

  try {
    const lid = String(sender || '');
    if (lid.endsWith('@lid') && sock?.signalRepository?.lidMapping?.getPNForLID) {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(lid);
      if (pn) {
        const num = String(pn).split('@')[0].split(':')[0].replace(/\D/g, '');
        if (num.length >= 10 && num.length <= 15) return num;
      }
    }
  } catch (e) {
    console.warn('[kiw] resolve LID gagal:', e.message);
  }

  return null;
}

function formatIdentitas(nomor, sender) {
  const isLid = String(sender || '').includes('@lid');
  if (nomor) {
    return `📱 *Nomor:* wa.me/${nomor}\n🆔 *JID:* ${sender}`;
  }
  if (isLid) {
    return (
      `📱 *Nomor:* tidak tersedia dari WhatsApp\n` +
      `🔗 *LID:* ${sender}\n` +
      `🆔 *JID:* ${sender}`
    );
  }
  return `🆔 *JID:* ${sender}`;
}

function menuText(prefix) {
  return (
    `*Menu Kiw*\n\n` +
    `Pilih salah satu:\n` +
    `1️⃣ *lapor* — kirim laporan ke admin\n` +
    `2️⃣ *join* — minta join akun ke grup\n\n` +
    `Contoh:\n` +
    `• ${prefix}kiw lapor\n` +
    `• ${prefix}kiw join\n` +
    `• atau ketik: *1* / *2*`
  );
}

function joinListText(username) {
  const list = config.grup_join || [];
  let t =
    `*Pilih Grup untuk akun: ${username}*\n` +
    `Bisa pilih lebih dari satu.\n\n`;
  list.forEach((g) => {
    t += `${g.no}. ${g.nama}\n`;
  });
  t +=
    `\nContoh balas:\n` +
    `• *1*\n` +
    `• *1,3,5*\n` +
    `• *all*\n\n` +
    `_Ketik langsung tanpa .kiw_\n` +
    `_Session 10 menit_`;
  return t;
}

async function kirimLaporanAdmin(
  sock,
  messageInfo,
  textLaporan,
  mediaPath,
  mediaType
) {
  const { sender, pushName } = messageInfo;
  const waktu = moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
  const nama = pushName || 'Tanpa Nama';
  const nomor = await resolveNomorWa(sock, messageInfo);
  const identitas = formatIdentitas(nomor, sender);

  const caption =
    `📢 *LAPORAN USER*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `👤 *Nama:* ${nama}\n` +
    `${identitas}\n` +
    `📍 *Dari:* Private Chat\n` +
    `🕒 *Waktu:* ${waktu}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📝 *Isi Laporan:*\n${textLaporan || '(media tanpa teks)'}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `_Balas pesan ini untuk membalas ke user._`;

  const target = config.group_laporan;
  if (!target) throw new Error('GROUP_LAPORAN belum diisi');

  let sent;
  if (mediaPath && fs.existsSync(mediaPath)) {
    const buffer = fs.readFileSync(mediaPath);
    if (mediaType === 'video') {
      sent = await sock.sendMessage(target, { video: buffer, caption });
    } else {
      sent = await sock.sendMessage(target, { image: buffer, caption });
    }
  } else {
    sent = await sock.sendMessage(target, { text: caption });
  }

  const msgId = sent?.key?.id;
  if (msgId) {
    saveReportRef(msgId, {
      userJid: sender,
      userName: nama,
      userNumber: nomor || null,
    });
  }

  return sent;
}

function bukaSesiChatAdmin(messageInfo, extra = {}) {
  setKiwSession(messageInfo, { mode: 'chat_admin', ...extra });
}

export async function processKiwSession(sock, messageInfo) {
  const {
    remoteJid,
    message,
    sender,
    pushName,
    type,
    isQuoted,
  } = messageInfo;

  const body = getSessionText(messageInfo);
  const bodyLower = body.toLowerCase();
  const sess = getKiwSession(messageInfo);
  if (!sess) return false;

  // ----- CHAT 2 ARAH: user → admin -----
  if (sess.mode === 'chat_admin') {
    if (['selesai', 'close', 'stop', 'end'].includes(bodyLower)) {
      const nama = pushName || 'Tanpa Nama';
      const nomor = await resolveNomorWa(sock, messageInfo);
      const identitas = formatIdentitas(nomor, sender);
      const waktu = moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');

      clearKiwSession(messageInfo);
      clearReportRefsByUser(sender);

      if (config.group_laporan) {
        try {
          await sock.sendMessage(config.group_laporan, {
            text:
              `🔒 *SESI CHAT DITUTUP*\n` +
              `━━━━━━━━━━━━━━━━\n` +
              `👤 *Nama:* ${nama}\n` +
              `${identitas}\n` +
              `🕒 *Waktu:* ${waktu}\n` +
              `━━━━━━━━━━━━━━━━\n` +
              `_User mengakhiri sesi. Balasan ke bubble lama tidak akan diteruskan._`,
          });
        } catch (e) {
          console.warn('[kiw] notif selesai ke admin gagal:', e.message);
        }
      }

      await sock.sendMessage(
        remoteJid,
        {
          text:
            '✅ Sesi chat dengan admin ditutup.\n' +
            'Pesan selanjutnya tidak diteruskan ke admin.',
        },
        { quoted: message }
      );
      return true;
    }

    const nama = pushName || 'Tanpa Nama';
    const nomor = await resolveNomorWa(sock, messageInfo);
    const identitas = formatIdentitas(nomor, sender);

    const mediaType = isQuoted ? isQuoted.type : type;
    let mediaPath = null;
    let mType = null;

    if (mediaType === 'image' || mediaType === 'video') {
      try {
        const media = isQuoted
          ? await downloadQuotedMedia(message)
          : await downloadMedia(message);
        mediaPath = path.join('tmp', media);
        mType = mediaType;
      } catch (e) {
        console.warn('[kiw] download media chat:', e.message);
      }
    }

    if (!body && !mediaPath) {
      await sock.sendMessage(
        remoteJid,
        {
          text: '_Kirim teks/foto/video, atau ketik *selesai* untuk tutup sesi._',
        },
        { quoted: message }
      );
      return true;
    }

    if (!config.group_laporan) {
      await sock.sendMessage(
        remoteJid,
        { text: '_⚠️ GROUP_LAPORAN belum diisi di config.js_' },
        { quoted: message }
      );
      return true;
    }

    const caption =
      `💬 *BALASAN USER*\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `👤 *Nama:* ${nama}\n` +
      `${identitas}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📝 *Pesan:*\n${body || '(media)'}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `_Balas pesan ini untuk membalas ke user._`;

    let sent;
    try {
      if (mediaPath && fs.existsSync(mediaPath)) {
        const buffer = fs.readFileSync(mediaPath);
        if (mType === 'video') {
          sent = await sock.sendMessage(config.group_laporan, {
            video: buffer,
            caption,
          });
        } else {
          sent = await sock.sendMessage(config.group_laporan, {
            image: buffer,
            caption,
          });
        }
      } else {
        sent = await sock.sendMessage(config.group_laporan, { text: caption });
      }
    } catch (e) {
      console.error('[kiw] forward chat_admin:', e.message);
      await sock.sendMessage(
        remoteJid,
        { text: '_⚠️ Gagal meneruskan pesan ke admin._' },
        { quoted: message }
      );
      return true;
    }

    const msgId = sent?.key?.id;
    if (msgId) {
      saveReportRef(msgId, {
        userJid: sender,
        userName: nama,
        userNumber: nomor || null,
      });
    }

    setKiwSession(messageInfo, {
      mode: 'chat_admin',
      from: sess.from,
      username: sess.username,
    });

    await sock.sendMessage(
      remoteJid,
      { text: '_✅ Pesan diteruskan ke admin._' },
      { quoted: message }
    );
    return true;
  }

  // ----- TUNGGU LAPORAN -----
  if (sess.mode === 'wait_lapor') {
    const mediaType = isQuoted ? isQuoted.type : type;
    let mediaPath = null;
    let mType = null;

    if (mediaType === 'image' || mediaType === 'video') {
      const media = isQuoted
        ? await downloadQuotedMedia(message)
        : await downloadMedia(message);
      mediaPath = path.join('tmp', media);
      mType = mediaType;
    }

    const teksLaporan = body;

    if (!teksLaporan && !mediaPath) {
      await sock.sendMessage(
        remoteJid,
        {
          text: '_Kirim teks, foto, atau video laporan (boleh balas pesan bot)._',
        },
        { quoted: message }
      );
      return true;
    }

    await sock.sendMessage(remoteJid, {
      react: { text: '⏰', key: message.key },
    });

    await kirimLaporanAdmin(sock, messageInfo, teksLaporan, mediaPath, mType);
    bukaSesiChatAdmin(messageInfo, { from: 'lapor' });

    await sock.sendMessage(
      remoteJid,
      {
        text:
          '✅ *Laporan terkirim ke admin.*\n\n' +
          'Silakan lanjut chat di sini — pesanmu akan diteruskan ke admin.\n' +
          'Ketik *selesai* untuk mengakhiri sesi.',
      },
      { quoted: message }
    );
    return true;
  }

  // ----- TUNGGU USERNAME -----
  if (sess.mode === 'wait_join_username') {
    const username = body.replace(/^@/, '').trim();
    if (!username || username.length < 2) {
      await sock.sendMessage(
        remoteJid,
        {
          text:
            '_Username tidak valid._\n' +
            'Ketik langsung username akunnya (tanpa .kiw).\n' +
            'Contoh: *username123*',
        },
        { quoted: message }
      );
      return true;
    }

    setKiwSession(messageInfo, {
      mode: 'wait_join_grup',
      username,
    });

    await sock.sendMessage(
      remoteJid,
      { text: joinListText(username) },
      { quoted: message }
    );
    return true;
  }

  // ----- TUNGGU PILIHAN GRUP -----
  if (sess.mode === 'wait_join_grup') {
    const list = config.grup_join || [];
    const username = sess.username;

    let selected = [];
    if (bodyLower === 'all' || bodyLower === 'semua') {
      selected = list;
    } else {
      const nums = body
        .split(/[,\s]+/)
        .map((x) => parseInt(x, 10))
        .filter((n) => !isNaN(n));
      selected = list.filter((g) => nums.includes(g.no));
    }

    if (!selected.length) {
      await sock.sendMessage(
        remoteJid,
        {
          text:
            '_Pilihan tidak valid._\n' +
            'Ketik langsung (tanpa .kiw):\n' +
            '• *1*\n• *1,3,5*\n• *all*',
        },
        { quoted: message }
      );
      return true;
    }

    const waktu = moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
    const nama = pushName || 'Tanpa Nama';
    const nomor = await resolveNomorWa(sock, messageInfo);
    const identitas = formatIdentitas(nomor, sender);
    const daftarGrup = selected.map((g) => `• ${g.no}. ${g.nama}`).join('\n');

    const teksAdmin =
      `👥 *PERMINTAAN JOIN GRUP*\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `🙋 *Pemohon:* ${nama}\n` +
      `${identitas}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `🎯 *Username akun:* *${username}*\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📌 *Grup yang dipilih:*\n${daftarGrup}\n` +
      `🕒 *Waktu:* ${waktu}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `_User sudah dikirimi link invite. Siap acc saat request masuk._\n` +
      `_Balas pesan ini untuk membalas ke pemohon._`;

    if (config.group_laporan) {
      const sent = await sock.sendMessage(config.group_laporan, {
        text: teksAdmin,
      });
      const msgId = sent?.key?.id;
      if (msgId) {
        saveReportRef(msgId, {
          userJid: sender,
          userName: nama,
          userNumber: nomor || null,
        });
      }
    }

    let out =
      `✅ *Permintaan tercatat.*\n\n` +
      `Akun: *${username}*\n` +
      `Silakan join lewat link berikut:\n\n`;

    selected.forEach((g) => {
      out += `• *${g.nama}*\n${g.link || '(link belum diisi)'}\n\n`;
    });
    out +=
      `_Setelah join, tunggu admin accept._\n\n` +
      `💬 Sesi chat ke admin *aktif 10 menit*.\n` +
      `Ketik langsung di sini jika ada kendala.\n` +
      `Ketik *selesai* untuk menutup sesi.`;

    // Jangan clear session — buka chat 2 arah 10 menit
    setKiwSession(messageInfo, {
      mode: 'chat_admin',
      ttl: JOIN_CHAT_TTL,
      from: 'join',
      username,
    });

    await sock.sendMessage(remoteJid, { text: out }, { quoted: message });
    return true;
  }

  // menu teks: 1 / 2
  if (sess.mode === 'menu') {
    if (bodyLower === '1' || bodyLower === 'lapor') {
      if (!config.group_laporan) {
        await sock.sendMessage(
          remoteJid,
          { text: '_⚠️ GROUP_LAPORAN belum diisi di config.js_' },
          { quoted: message }
        );
        return true;
      }
      setKiwSession(messageInfo, { mode: 'wait_lapor' });
      await sock.sendMessage(
        remoteJid,
        {
          text:
            `📝 *Mode Laporan*\n\n` +
            `Kirim *teks / foto / video* laporan kamu sekarang.\n` +
            `Boleh *membalas pesan ini*.\n` +
            `_Ketik langsung tanpa .kiw_\n\n` +
            `_Session 10 menit_`,
        },
        { quoted: message }
      );
      return true;
    }

    if (bodyLower === '2' || bodyLower === 'join') {
      setKiwSession(messageInfo, { mode: 'wait_join_username' });
      await sock.sendMessage(
        remoteJid,
        {
          text:
            `👥 *Join Akun ke Grup*\n\n` +
            `Ketik *username* akun yang ingin di-join.\n` +
            `_Langsung ketik username, tanpa .kiw_\n\n` +
            `Contoh:\n• username123\n\n` +
            `_Session 10 menit_`,
        },
        { quoted: message }
      );
      return true;
    }
  }

  return false;
}

async function handle(sock, messageInfo) {
  const {
    remoteJid,
    message,
    content,
    prefix,
    command,
    isGroup,
  } = messageInfo;

  try {
    if (isGroup) {
      return sock.sendMessage(
        remoteJid,
        { text: '_⚠️ Fitur *.kiw* hanya untuk chat pribadi ke bot._' },
        { quoted: message }
      );
    }

    const processed = await processKiwSession(sock, messageInfo);
    if (processed) return;

    const body = getSessionText(messageInfo);
    const bodyLower = body.toLowerCase();

    // .kiw saja → menu TEKS
    if (!body) {
      setKiwSession(messageInfo, { mode: 'menu' });
      return sock.sendMessage(
        remoteJid,
        { text: menuText(prefix) },
        { quoted: message }
      );
    }

    if (bodyLower === 'lapor' || bodyLower === '1') {
      if (!config.group_laporan) {
        return sock.sendMessage(
          remoteJid,
          { text: '_⚠️ GROUP_LAPORAN belum diisi di config.js_' },
          { quoted: message }
        );
      }
      setKiwSession(messageInfo, { mode: 'wait_lapor' });
      return sock.sendMessage(
        remoteJid,
        {
          text:
            `📝 *Mode Laporan*\n\n` +
            `Kirim *teks / foto / video* laporan kamu sekarang.\n` +
            `Boleh *membalas pesan ini*.\n` +
            `_Ketik langsung tanpa .kiw_\n\n` +
            `_Session 10 menit_`,
        },
        { quoted: message }
      );
    }

    if (bodyLower === 'join' || bodyLower === '2') {
      setKiwSession(messageInfo, { mode: 'wait_join_username' });
      return sock.sendMessage(
        remoteJid,
        {
          text:
            `👥 *Join Akun ke Grup*\n\n` +
            `Ketik *username* akun yang ingin di-join.\n` +
            `_Langsung ketik username, tanpa .kiw_\n\n` +
            `Contoh:\n• username123\n\n` +
            `_Session 10 menit_`,
        },
        { quoted: message }
      );
    }

    if (command === 'kiw' && body) {
      await sock.sendMessage(remoteJid, {
        react: { text: '⏰', key: message.key },
      });
      await kirimLaporanAdmin(sock, messageInfo, body, null, null);
      bukaSesiChatAdmin(messageInfo, { from: 'lapor' });
      return sock.sendMessage(
        remoteJid,
        {
          text:
            '✅ *Laporan terkirim ke admin.*\n\n' +
            'Silakan lanjut chat di sini — pesanmu akan diteruskan ke admin.\n' +
            'Ketik *selesai* untuk mengakhiri sesi.',
        },
        { quoted: message }
      );
    }

    setKiwSession(messageInfo, { mode: 'menu' });
    return sock.sendMessage(
      remoteJid,
      { text: menuText(prefix) },
      { quoted: message }
    );
  } catch (error) {
    console.error('Error kiw:', error.message);
    logCustom('error', content, 'ERROR-COMMAND-kiw.txt');
    clearKiwSession(messageInfo);
    return sock.sendMessage(
      remoteJid,
      {
        text:
          `_⚠️ Gagal memproses._\n` +
          `Pastikan bot join grup admin & config sudah benar.`,
      },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ['kiw'],
  OnlyPremium: false,
  OnlyOwner: false,
  OnlyPrivate: true,
  OnlyGroup: false,
};