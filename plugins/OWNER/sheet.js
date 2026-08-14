import config from '../../config.js';
import { google } from 'googleapis';
import moment from 'moment-timezone';

function parseCredentials() {
  const raw = config.google_credentials;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS belum diisi');
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function getSheets() {
  const creds = parseCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/** join → JOIN!A:D | suspend → Suspend!A:D */
function getRangeByTipe(tipe) {
  const t = String(tipe || '').toLowerCase();
  if (t === 'join') return 'JOIN!A:D';
  if (t === 'suspend') return 'Suspend!A:D';
  throw new Error('Tipe harus join atau suspend');
}

async function appendRows(tipe, usernames, adminName) {
  const sheets = await getSheets();
  const sheetId = config.google_sheet_id;
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID belum diisi');

  const range = getRangeByTipe(tipe);
  const waktu = moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');

  // Header sheet: waktu | username | admin | sumber
  const values = usernames.map((u) => [
    waktu,
    u,
    adminName || '-',
    'admin-push',
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  return {
    waktu,
    sheetName: range.split('!')[0],
  };
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command, pushName } =
    messageInfo;

  try {
    const body = (content || '').trim();
    if (!body) {
      return sock.sendMessage(
        remoteJid,
        {
          text:
            `*Push ke Spreadsheet*\n\n` +
            `_Format:_\n` +
            `• *${prefix}${command} join user123*\n` +
            `• *${prefix}${command} join user1, user2*\n` +
            `• *${prefix}${command} suspend akunX*\n` +
            `• *${prefix}${command} suspend a, b, c*\n\n` +
            `_join → sheet JOIN_\n` +
            `_suspend → sheet Suspend_`,
        },
        { quoted: message }
      );
    }

    const parts = body.split(/\s+/);
    const tipe = (parts.shift() || '').toLowerCase();

    if (!['join', 'suspend'].includes(tipe)) {
      return sock.sendMessage(
        remoteJid,
        {
          text:
            '_Tipe harus *join* atau *suspend*._\n' +
            `Contoh: *${prefix}${command} suspend user123*`,
        },
        { quoted: message }
      );
    }

    const usernames = [
      ...new Set(
        parts
          .join(' ')
          .split(/[,\s]+/)
          .map((u) => u.replace(/^@/, '').trim())
          .filter((u) => u.length >= 2)
      ),
    ];

    if (!usernames.length) {
      return sock.sendMessage(
        remoteJid,
        { text: '_Minimal 1 username._' },
        { quoted: message }
      );
    }

    await sock.sendMessage(remoteJid, {
      react: { text: '⏰', key: message.key },
    });

    const result = await appendRows(tipe, usernames, pushName || 'Admin');

    return sock.sendMessage(
      remoteJid,
      {
        text:
          `✅ *Tersimpan ke Spreadsheet*\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `📋 Tipe: *${tipe}*\n` +
          `📑 Sheet: *${result.sheetName}*\n` +
          `🕒 ${result.waktu}\n` +
          `👤 Admin: ${pushName || '-'}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `Username (${usernames.length}):\n` +
          usernames.map((u) => `• ${u}`).join('\n'),
      },
      { quoted: message }
    );
  } catch (e) {
    console.error('sheet:', e.message);
    return sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Gagal push sheet:_\n${e.message}` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ['sheet', 'pushsheet'],
  OnlyOwner: false,
  OnlyPremium: false,
};