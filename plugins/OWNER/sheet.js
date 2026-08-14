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

function getRangeByTipe(tipe) {
  const t = String(tipe || '').toLowerCase();
  if (t === 'join') return 'JOIN!A:J';
  if (t === 'suspend') return 'Suspend!A:D';
  throw new Error('Tipe harus join atau suspend');
}

function getOrderedGrup() {
  const list = config.grup_join || [];
  return [...list].sort((a, b) => a.no - b.no);
}

/** "1,3,5" / "all" → [1,3,5] */
function parseGrupNumbers(grupInput) {
  const list = getOrderedGrup();
  const raw = String(grupInput || '').trim().toLowerCase();
  if (!raw) return [];

  if (raw === 'all' || raw === 'semua') {
    return list.map((g) => g.no);
  }

  return raw
    .split(/[,\s]+/)
    .map((x) => parseInt(x, 10))
    .filter((n) => !isNaN(n) && list.some((g) => g.no === n));
}

/**
 * "username1, username2 grup 1,3,5"
 * "userA grup all"
 * "userB"
 */
function parseJoinBody(bodyAfterTipe) {
  const text = (bodyAfterTipe || '').trim();
  if (!text) return { usernames: [], grupNos: [] };

  const m = text.match(/^(.*?)\s+grup\s+(.+)$/i);
  let userPart = text;
  let grupPart = '';
  if (m) {
    userPart = m[1].trim();
    grupPart = m[2].trim();
  }

  const usernames = [
    ...new Set(
      userPart
        .split(/[,\s]+/)
        .map((u) => u.replace(/^@/, '').trim())
        .filter((u) => u.length >= 2)
    ),
  ];

  return {
    usernames,
    grupNos: parseGrupNumbers(grupPart),
  };
}

function parseSuspendBody(bodyAfterTipe) {
  return [
    ...new Set(
      String(bodyAfterTipe || '')
        .split(/[,\s]+/)
        .map((u) => u.replace(/^@/, '').trim())
        .filter((u) => u.length >= 2)
    ),
  ];
}

async function appendRows(tipe, usernames, adminName, grupNos = []) {
  const sheets = await getSheets();
  const sheetId = config.google_sheet_id;
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID belum diisi');

  const range = getRangeByTipe(tipe);
  const waktu = moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
  const ordered = getOrderedGrup();

  let values;

  if (tipe === 'join') {
    // waktu | username | g1 | g2 | g3 | g4 | g5 | g6 | admin | sumber
    values = usernames.map((u) => {
      const checks = ordered.map((g) =>
        grupNos.includes(g.no) ? '✓' : ''
      );
      // jika grup di config < 6, tetap pad sampai 6 kolom biar rapi
      while (checks.length < 6) checks.push('');
      return [
        waktu,
        u,
        checks[0],
        checks[1],
        checks[2],
        checks[3],
        checks[4],
        checks[5],
        adminName || '-',
        'admin-push',
      ];
    });
  } else {
    // suspend: waktu | username | admin | sumber
    values = usernames.map((u) => [
      waktu,
      u,
      adminName || '-',
      'admin-push',
    ]);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  const grupLabel = ordered
    .filter((g) => grupNos.includes(g.no))
    .map((g) => `${g.no}. ${g.nama}`)
    .join(', ');

  return {
    waktu,
    sheetName: range.split('!')[0],
    grupLabel: grupLabel || '-',
  };
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command, pushName } =
    messageInfo;

  try {
    const body = (content || '').trim();
    if (!body) {
      const ordered = getOrderedGrup();
      const daftarGrup =
        ordered.length > 0
          ? ordered.map((g) => `  ${g.no}. ${g.nama}`).join('\n')
          : '  (belum diisi di config)';

      return sock.sendMessage(
        remoteJid,
        {
          text:
            `*Push ke Spreadsheet*\n\n` +
            `• *${prefix}${command} join user1, user2 grup 1,3,5*\n` +
            `• *${prefix}${command} join userA grup all*\n` +
            `• *${prefix}${command} join userB*\n` +
            `• *${prefix}${command} suspend akunX, akunY*\n\n` +
            `*Daftar grup:*\n${daftarGrup}`,
        },
        { quoted: message }
      );
    }

    const parts = body.split(/\s+/);
    const tipe = (parts.shift() || '').toLowerCase();
    const rest = parts.join(' ').trim();

    if (!['join', 'suspend'].includes(tipe)) {
      return sock.sendMessage(
        remoteJid,
        {
          text:
            '_Tipe harus *join* atau *suspend*._\n' +
            `Contoh: *${prefix}${command} join user1, user2 grup 1,3,5*`,
        },
        { quoted: message }
      );
    }

    let usernames = [];
    let grupNos = [];

    if (tipe === 'join') {
      const parsed = parseJoinBody(rest);
      usernames = parsed.usernames;
      grupNos = parsed.grupNos;
    } else {
      usernames = parseSuspendBody(rest);
    }

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

    const result = await appendRows(
      tipe,
      usernames,
      pushName || 'Admin',
      grupNos
    );

    let teks =
      `✅ *Tersimpan ke Spreadsheet*\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📋 Tipe: *${tipe}*\n` +
      `📑 Sheet: *${result.sheetName}*\n` +
      `🕒 ${result.waktu}\n` +
      `👤 Admin: ${pushName || '-'}\n`;

    if (tipe === 'join') {
      teks += `📌 Grup: *${result.grupLabel}*\n`;
    }

    teks +=
      `━━━━━━━━━━━━━━━━\n` +
      `Username (${usernames.length}):\n` +
      usernames.map((u) => `• ${u}`).join('\n');

    return sock.sendMessage(remoteJid, { text: teks }, { quoted: message });
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