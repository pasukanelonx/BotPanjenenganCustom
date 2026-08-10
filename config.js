/*
⚠️ PERINGATAN:
Script ini **TIDAK BOLEH DIPERJUALBELIKAN** dalam bentuk apa pun!

╔══════════════════════════════════════════════╗
║                🛠️ INFORMASI SCRIPT          ║
╠══════════════════════════════════════════════╣
║ 📦 Version   : 5.3.0
║ 👨‍💻 Developer  : Mail bin Mail                ║
║ 🌐 Website    : https://autoresbot.com       ║
║ 💻 GitHub  : github.com/autoresbot/resbot-md ║
╚══════════════════════════════════════════════╝

📌 Mulai 11 April 2025,
Script **Autoresbot** resmi menjadi **Open Source** dan dapat digunakan secara gratis:
🔗 https://autoresbot.com
*/

import moment from 'moment-timezone';

const CONNECTION = 'pairing'; // qr atau pairing
const PAIRING_CODE = 'PNJGBOTS'; // kode pairing max 8 karakter (opsional)
const OWNER_NAME = 'PanjenenganBOT';
const NOMOR_BOT = '62881012374403'; // 628xx nomor wa - 62881012374403
const DESTINATION = 'both'; // group , private, both
const APIKEY = ''; // apikey dari autoresbot.com (paket apikey)
const RATE_LIMIT = 3000; // 3 detik/chat
const SIMILARITY = true; // Pencarian kemiripan command (true, false)
const MODE = 'production'; // [production, development] (jangan di ubah kecuali anda developer)
const VERSION = global.version; // don't edit
// ====== API GRATIS / SENDIRI ======
const GEMINI_API_KEY = '';        // dari https://aistudio.google.com/apikey
const GROQ_API_KEY = '';          // dari https://console.groq.com (opsional)
const REMOVEBG_API_KEY = '';      // dari https://www.remove.bg/api (free 50/bulan)
const RAPIDAPI_KEY = '';          // opsional, untuk beberapa endpoint RapidAPI free

const EMAIL = 'panjenengan@gmail.com';
const REGION = 'Indonesia';
const WEBSITE = 'panjenengan.com';
const DATA_OWNER = ['225155104116838@lid']; // cara ambil owner https://youtu.be/qrRXPCSFvRo?si=KOWdFhrScHN7Ugd4 

// Konfiqurasi Chat
const ANTI_CALL = false; // jika true (setiap yang nelpon pribadi akan di block)
const AUTO_READ = true; // jika true (setiap chat akan di baca/centang 2 biru)
const AUTO_BACKUP = false; // jika true (setiap restart server, data backup di kirimkan ke wa owner);
const MIDNIGHT_RESTART = false; // Restart setiap jam 12 malam
const PRESENCE_UPDATE = ''; // unavailable, available, composing, recording, paused
const TYPE_WELCOME = '1'; // 1, 2, 3, 4, 5, 6 text dan random
const BG_WELCOME2 = 'https://api.autoresbot.com/api/maker/bg-default';

// Konfiqurasi Panel
// Tutor : https://youtu.be/ZAWb7tnKjoM?si=jMUiB13KkXE1H7IG
const PANEL_URL = '';
const PANEL_PLTA = '';
const PANEL_DESCRIPTION = 'Butuh Bantuan Hubungi 6289654123485';
const PANEL_ID_EGG = 15;
const PANEL_ID_LOCATION = 1;
const PANEL_DEFAULT_DISK = 5120; // 5GB atau 0 (unlimited)
const PANEL_DEFAULT_CPU = 90;

// antibadword di grub
const BADWORD_WARNING = 3; // Jumlah maksimum peringatan sebelum tindakan diambil
const BADWORD_ACTION = 'both'; // tindakan setelah warning terpenuhi (kick, block, both)

// antispam di grub
const SPAM_LIMIT = 3; // Batas pesan dianggap spam
const SPAM_COULDOWN = 10; // Waktu cooldown dalam detik (10 detik)
const SPAM_WARNING = 3; // Jumlah maksimum peringatan sebelum tindakan diambil
const SPAM_ACTION = 'both'; // tindakan setelah warning terpenuhi (kick, block, both)

// More
const STATUS_SCHEDULED = true;

const config = {
  APIKEY,
  GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
  GROQ_API_KEY = process.env.GROQ_API_KEY || '';
  REMOVEBG_API_KEY,
  RAPIDAPI_KEY,
  phone_number_bot: NOMOR_BOT,
  type_connection: CONNECTION,
  pairing_code: PAIRING_CODE,
  bot_destination: DESTINATION,
  owner_name: OWNER_NAME,
  owner_number: DATA_OWNER,
  owner_website: WEBSITE,
  owner_email: EMAIL,
  region: REGION,
  version: VERSION,
  rate_limit: RATE_LIMIT,
  status_prefix: true, // wajib prefix : atau false tanpa prefix
  prefix: ['.', '!', '#'],
  sticker_packname: OWNER_NAME,
  sticker_author: `Date: ${moment
    .tz('Asia/Jakarta')
    .format('DD/MM/YY')}\nYouTube: Mail bin Mail\nOwner: 0896-5412-3485`,
  mode: MODE,
  commandSimilarity: SIMILARITY,
  anticall: ANTI_CALL,
  autoread: AUTO_READ,
  autobackup: AUTO_BACKUP,
  PresenceUpdate: PRESENCE_UPDATE,
  typewelcome: TYPE_WELCOME,
  bgwelcome2: BG_WELCOME2,
  midnight_restart: MIDNIGHT_RESTART,
  scheduled: STATUS_SCHEDULED,
  PANEL: {
    URL: PANEL_URL,
    KEY_APPLICATION: PANEL_PLTA,
    description: PANEL_DESCRIPTION,
    SERVER_EGG: PANEL_ID_EGG,
    id_location: PANEL_ID_LOCATION,
    default_disk: PANEL_DEFAULT_DISK,
    cpu_default: PANEL_DEFAULT_CPU,
  },
  SPAM: {
    limit: SPAM_LIMIT,
    couldown: SPAM_COULDOWN,
    warning: SPAM_WARNING,
    action: SPAM_ACTION,
  },
  BADWORD: {
    warning: BADWORD_WARNING,
    action: BADWORD_ACTION,
  },
};

export default config;
