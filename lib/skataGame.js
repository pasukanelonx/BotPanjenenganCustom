// Sambung Kata (Skata) untuk grup WhatsApp.
// Pemain bergiliran menyambung kata dari SUKU KATA terakhir kata sebelumnya. Kata harus ada di KBBI
// (kata dasar), belum pernah dipakai di ronde ini. Waktu per giliran 45 detik; kehabisan waktu atau
// "nyerah" = tereliminasi. Pemain terakhir yang bertahan menang.
// Jawaban diketik langsung tanpa titik — hanya pesan dari pemain yang sedang giliran yang diproses.
import fs from 'fs';
import path from 'path';
import { idsOf, normJid } from './unoGame.js';

const STATE_FILE = path.join(process.cwd(), 'database', 'temporary_db', 'skata-state.json');
const KBBI_FILE = path.join(process.cwd(), 'lib', 'data', 'kbbi.json');
const TURN_SECONDS = 45;
const LOBBY_MINUTES = 3; // lobi batal kalau tidak dimulai
const NEXT_DELAY = 4; // detik jeda sebelum lanjut ke pemain berikutnya setelah ada yang tereliminasi
const MAX_PLAYERS = 30;

let games = {}; // groupJid -> game
let SOCK = null;
let ticker = null;
let KBBI = null;

/* ================= kamus ================= */
function kbbi() {
  if (!KBBI) {
    try {
      KBBI = new Set(JSON.parse(fs.readFileSync(KBBI_FILE, 'utf8')).map((w) => String(w).toLowerCase()));
    } catch (e) {
      console.error('[skata] gagal memuat KBBI:', e.message);
      KBBI = new Set();
    }
  }
  return KBBI;
}
export const isWord = (w) => kbbi().has(String(w || '').toLowerCase());

const START_LETTERS = ['a', 'b', 'c', 'd', 'e', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'u', 'w'];
function randomWord() {
  const words = [...kbbi()].filter((w) => /^[a-z]{3,7}$/.test(w));
  if (!words.length) return 'kata';
  const h = START_LETTERS[Math.floor(Math.random() * START_LETTERS.length)];
  const pool = words.filter((w) => w.startsWith(h));
  const list = pool.length ? pool : words;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Suku kata akhir yang harus menjadi awal kata berikutnya (aturan sama dengan Skata sebelumnya).
 * Contoh: kijang → "jang", pisang → "sang", tiup → "up", kamu → "mu", langit → "ngit".
 */
export function suffix(text) {
  text = String(text || '').toLowerCase();
  const mati = 'qwrtypsdfghjklzxcvbnm';
  if (text.length < 3) return text;
  if (/([qwrtypsdfghjklzxcvbnm][qwrtypsdfhjklzxcvbnm])$/.test(text)) return /([qwrtypsdfhjklzxcvbnm])$/.exec(text)[0];
  if (/([qwrtypsdfghjklzxcvbnm][aiueo]ng)$/.test(text)) return /([qwrtypsdfghjklzxcvbnm][aiueo]ng)$/.exec(text)[0];
  if (/([aiueo][aiueo]([qwrtypsdfghjklzxcvbnm]|ng)?)$/.test(text)) {
    if (/ng$/.test(text)) return text.slice(-3);
    if (/[qwrtypsdfghjklzxcvbnm]$/.test(text)) return text.slice(-2);
    return text.slice(-1);
  }
  if (/n[gy]([aiueo]([qwrtypsdfghjklzxcvbnm])?)$/.test(text)) {
    const ny = /n[gy]/.exec(text)[0];
    const parts = text.split(ny);
    return ny + parts[parts.length - 1];
  }
  const cons = [...text].filter((c) => mati.includes(c));
  let last = cons[cons.length - 1];
  if (mati.includes(text[text.length - 1])) last = cons[cons.length - 2];
  if (!last) return text.slice(-2);
  const parts = text.split(last);
  if (text.endsWith(last)) return last + parts[parts.length - 2] + last;
  return last + parts[parts.length - 1];
}

/* ================= util ================= */
const user = (j) => normJid(j).split('@')[0];
const tag = (p) => `@${user(p.mention)}`;
const cur = (g) => g.players.find((p) => p.key === g.alive[g.turn]);
const alivePlayers = (g) => g.alive.map((k) => g.players.find((p) => p.key === k)).filter(Boolean);

function save() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(games));
  } catch (e) {
    console.error('[skata] simpan:', e.message);
  }
}
function load() {
  try {
    if (fs.existsSync(STATE_FILE)) games = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {};
  } catch {
    games = {};
  }
}

async function send(g, text, mentions = null) {
  if (!SOCK) return;
  try {
    const m = mentions || g.players.filter((p) => text.includes('@' + user(p.mention))).map((p) => p.mention);
    await SOCK.sendMessage(g.group, { text, mentions: m });
  } catch (e) {
    console.error('[skata] kirim:', e.message);
  }
}

function makePlayer(mi) {
  const ids = idsOf(mi);
  return { key: ids[0] || normJid(mi.sender), ids, mention: normJid(mi.sender), name: mi.pushName || user(mi.sender), words: 0 };
}
const findIn = (g, mi) => {
  const ids = idsOf(mi);
  return g.players.find((p) => p.ids.some((i) => ids.includes(i))) || null;
};

/* ================= API untuk plugin ================= */
export function setSock(sock) {
  SOCK = sock;
  if (!ticker) {
    load();
    ticker = setInterval(tick, 2000);
    ticker.unref?.();
  }
}

export const getGame = (group) => games[group] || null;

/** .skata — buat lobi atau ikut lobi yang ada. */
export function joinOrCreate(mi) {
  let g = games[mi.remoteJid];
  if (!g) {
    const p = makePlayer(mi);
    g = games[mi.remoteJid] = { group: mi.remoteJid, phase: 'lobby', host: p.key, players: [p], alive: [], used: [], word: '', turn: 0, deadline: 0, nextAt: 0, lobbyAt: Date.now(), round: 0 };
    save();
    return { g, created: true };
  }
  if (g.phase !== 'lobby') return { err: 'Sambung Kata sedang berjalan di grup ini. Tunggu ronde berikutnya.' };
  if (findIn(g, mi)) return { err: 'Kamu sudah ikut.' };
  if (g.players.length >= MAX_PLAYERS) return { err: `Lobi penuh (${MAX_PLAYERS} pemain).` };
  g.players.push(makePlayer(mi));
  g.lobbyAt = Date.now();
  save();
  return { g };
}

export function lobbyText(g) {
  return (
    `🔤 *S A M B U N G - K A T A*\n\n` +
    `Pemain (${g.players.length}):\n${g.players.map((p, i) => `${i + 1}. ${tag(p)}${p.key === g.host ? ' 👑' : ''}`).join('\n')}\n\n` +
    `Ikut: *.skata* · Mulai (pembuat): *.skata mulai*\n` +
    `_Lobi batal otomatis kalau tidak dimulai dalam ${LOBBY_MINUTES} menit._`
  );
}

export const RULES =
  `• Sambung kata dari *suku kata terakhir* kata sebelumnya\n` +
  `• Kata dasar yang ada di KBBI, tanpa spasi, tanpa imbuhan\n` +
  `• Kata yang sudah dipakai tidak boleh diulang\n` +
  `• Waktu ${TURN_SECONDS} detik per giliran; habis waktu = gugur\n` +
  `• Ketik *nyerah* untuk menyerah\n` +
  `• Pemain terakhir yang bertahan *menang*`;

async function announceTurn(g, head = '') {
  const p = cur(g);
  g.deadline = Date.now() + TURN_SECONDS * 1000;
  save();
  await send(g, `${head ? head + '\n\n' : ''}Giliran ${tag(p)}\nKata: *${g.word.toUpperCase()}*\nSambung dengan: *${suffix(g.word).toUpperCase()}...*\n_${TURN_SECONDS} detik · ketik jawaban langsung · "nyerah" untuk menyerah_`);
}

export async function start(mi) {
  const g = games[mi.remoteJid];
  if (!g) return { err: 'Belum ada lobi. Ketik *.skata* untuk membuat.' };
  if (g.phase !== 'lobby') return { err: 'Permainan sudah berjalan.' };
  const me = findIn(g, mi);
  if (!me) return { err: 'Kamu belum ikut. Ketik *.skata* dulu.' };
  if (me.key !== g.host) return { err: 'Hanya pembuat lobi yang bisa memulai.' };
  if (g.players.length < 2) return { err: 'Minimal 2 pemain.' };
  g.phase = 'play';
  g.alive = g.players.map((p) => p.key);
  g.turn = 0;
  g.used = [];
  g.word = randomWord();
  g.used.push(g.word);
  await announceTurn(g, `🔤 *Sambung Kata dimulai!* ${g.players.length} pemain, giliran sesuai urutan daftar.`);
  return { g };
}

async function eliminate(g, reason) {
  const p = cur(g);
  g.alive.splice(g.turn, 1);
  if (g.alive.length <= 1) {
    const w = alivePlayers(g)[0];
    delete games[g.group];
    save();
    const top = [...g.players].sort((a, b) => b.words - a.words).slice(0, 3).filter((x) => x.words > 0);
    await send(g, `${reason.replace('{p}', tag(p))}\n\n🏆 *${w ? tag(w) : '-'} MENANG!* Bertahan sampai akhir.\n` +
      (top.length ? `\nKata terbanyak:\n${top.map((x, i) => `${i + 1}. ${x.name} — ${x.words} kata`).join('\n')}` : ''));
    return;
  }
  if (g.turn >= g.alive.length) g.turn = 0;
  g.deadline = 0;
  g.nextAt = Date.now() + NEXT_DELAY * 1000; // lanjut otomatis dengan kata baru
  save();
  await send(g, `${reason.replace('{p}', tag(p))}\nSisa ${g.alive.length} pemain. Lanjut ke ${tag(cur(g))} dengan kata baru...`);
}

export async function leave(mi) {
  const g = games[mi.remoteJid];
  if (!g) return { err: 'Tidak ada Sambung Kata di grup ini.' };
  const p = findIn(g, mi);
  if (!p) return { err: 'Kamu tidak ikut.' };
  if (g.phase === 'lobby') {
    g.players = g.players.filter((x) => x !== p);
    if (!g.players.length || p.key === g.host) { delete games[g.group]; save(); return { msg: '🚪 Lobi Sambung Kata dibubarkan.' }; }
    save();
    return { msg: `🚪 ${p.name} keluar dari lobi.` };
  }
  const idx = g.alive.indexOf(p.key);
  if (idx < 0) return { err: 'Kamu sudah tereliminasi.' };
  if (idx === g.turn) { await eliminate(g, '🏳️ {p} keluar dari permainan.'); return { msg: null }; }
  g.alive.splice(idx, 1);
  if (idx < g.turn) g.turn -= 1;
  if (g.alive.length <= 1) { g.turn = 0; g.alive.unshift(p.key); await eliminate(g, '🏳️ {p} keluar dari permainan.'); return { msg: null }; }
  save();
  return { msg: `🏳️ ${p.name} keluar. Sisa ${g.alive.length} pemain.` };
}

export async function stop(mi, isAdmin) {
  const g = games[mi.remoteJid];
  if (!g) return { err: 'Tidak ada Sambung Kata di grup ini.' };
  const p = findIn(g, mi);
  if (!isAdmin && (!p || p.key !== g.host)) return { err: 'Hanya pembuat lobi atau admin grup yang bisa menghentikan.' };
  delete games[g.group];
  save();
  return { msg: '⏹️ Sambung Kata dihentikan.' };
}

export function statusText(group) {
  const g = games[group];
  if (!g) return 'Tidak ada Sambung Kata. Mulai: *.skata*';
  if (g.phase === 'lobby') return lobbyText(g);
  return `🔤 Sambung Kata — sisa ${g.alive.length} pemain\nKata: *${g.word.toUpperCase()}* → *${suffix(g.word).toUpperCase()}...*\nGiliran: ${tag(cur(g))}\nBertahan: ${alivePlayers(g).map((p) => p.name).join(', ')}`;
}

/**
 * Jawaban tanpa titik. Mengembalikan { handled, reply }.
 * Hanya pemain yang sedang giliran yang diproses; pesan orang lain dibiarkan (obrolan grup tetap jalan).
 */
export async function answer(mi, rawText) {
  const g = games[mi.remoteJid];
  if (!g || g.phase !== 'play' || g.nextAt) return { handled: false };
  const p = cur(g);
  if (!p || !p.ids.some((i) => idsOf(mi).includes(i))) return { handled: false };
  const text = String(rawText || '').trim().toLowerCase();
  if (/^(nyerah|menyerah)$/.test(text)) {
    await eliminate(g, '🏳️ {p} menyerah!');
    return { handled: true };
  }
  // anggap sebagai jawaban hanya kalau satu kata (huruf/strip); kalimat biasa dibiarkan
  if (!/^[a-z-]{2,30}$/.test(text)) return { handled: false };
  const need = suffix(g.word);
  if (!text.startsWith(need)) return { handled: true, reply: `👎 Harus diawali *${need.toUpperCase()}*` };
  if (!isWord(text)) return { handled: true, reply: `👎 *${text.toUpperCase()}* tidak ada di KBBI` };
  if (g.used.includes(text)) return { handled: true, reply: `👎 *${text.toUpperCase()}* sudah dipakai` };
  g.used.push(text);
  g.word = text;
  p.words = (p.words || 0) + 1;
  g.turn = (g.turn + 1) % g.alive.length;
  await announceTurn(g, `👍 ${p.name}: *${text.toUpperCase()}*`);
  return { handled: true };
}

/* ================= timer ================= */
async function tick() {
  const now = Date.now();
  for (const g of Object.values(games)) {
    try {
      if (g.phase === 'lobby') {
        if (now - g.lobbyAt > LOBBY_MINUTES * 60000) {
          delete games[g.group];
          save();
          await send(g, '⌛ Sambung Kata dibatalkan (tidak dimulai).');
        }
        continue;
      }
      if (g.nextAt && now >= g.nextAt) {
        g.nextAt = 0;
        g.word = randomWord();
        g.used.push(g.word);
        await announceTurn(g);
        continue;
      }
      if (g.deadline && now >= g.deadline) {
        g.deadline = 0;
        await eliminate(g, '⌛ Waktu habis! {p} tereliminasi.');
      }
    } catch (e) {
      console.error('[skata] tick:', e.message);
    }
  }
}

export const _test = { games: () => games, reset: () => { games = {}; }, tick, setDeadline: (group, t) => { games[group].deadline = t; }, setNext: (group, t) => { games[group].nextAt = t; } };
