// UNO untuk grup WhatsApp.
// Meja di grup; kartu di tangan dikirim lewat DM. Pemain bisa main dari grup ATAU dari DM
// cukup dengan mengetik nomor kartu / "ambil" / "lewat" / "uno" / "tangkap" (tanpa titik).
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'database', 'temporary_db', 'uno-state.json');
const TURN_SECONDS = 60; // batas waktu per giliran
const LOBBY_MINUTES = 5; // lobi batal kalau tidak dimulai
const AFK_LIMIT = 3; // 3x kehabisan waktu -> dikeluarkan
const MAX_PLAYERS = 10;
const HAND_SIZE = 7;

const COLORS = { r: '🟥', b: '🟦', g: '🟩', y: '🟨', w: '⬛' };
const COLOR_NAME = { r: 'merah', b: 'biru', g: 'hijau', y: 'kuning' };
const COLOR_INPUT = { merah: 'r', m: 'r', red: 'r', biru: 'b', b: 'b', blue: 'b', hijau: 'g', h: 'g', green: 'g', kuning: 'y', k: 'y', yellow: 'y' };
const LABEL = { skip: 'Skip', rev: 'Reverse', '+2': '+2', wild: 'Wild', '+4': 'Wild +4' };

let games = {}; // groupJid -> game
let SOCK = null;
let ticker = null;

/* ================= util ================= */
export const normJid = (j) => String(j || '').replace(/:\d+@/, '@');
const user = (j) => normJid(j).split('@')[0];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Semua identitas pengirim (LID / nomor) supaya pemain dikenali di grup maupun DM. */
export function idsOf(mi) {
  const k = mi?.message?.key || {};
  const arr = [mi.sender, mi.senderLid, k.participant, k.participantAlt, k.participantPn, k.senderPn];
  if (!mi.isGroup) arr.push(mi.remoteJid, k.remoteJid, k.remoteJidAlt);
  return [...new Set(arr.filter((x) => x && /@(s\.whatsapp\.net|lid)$/.test(normJid(x))).map(normJid))];
}

export function cardText(c) {
  const v = LABEL[c.v] || c.v;
  return `${COLORS[c.c]} ${v}`;
}

function newDeck() {
  const d = [];
  for (const c of ['r', 'b', 'g', 'y']) {
    d.push({ c, v: '0' });
    for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', '+2']) d.push({ c, v }, { c, v });
  }
  for (let i = 0; i < 4; i++) d.push({ c: 'w', v: 'wild' }, { c: 'w', v: '+4' });
  return shuffle(d);
}

const top = (g) => g.discard[g.discard.length - 1];
const canPlay = (g, card) => card.c === 'w' || card.c === g.color || card.v === top(g).v;
const cur = (g) => g.players[g.turn];
const nextIndex = (g, steps = 1) => {
  const n = g.players.length;
  return (((g.turn + g.dir * steps) % n) + n) % n;
};

function draw(g, n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!g.deck.length) {
      const t = g.discard.pop();
      g.deck = shuffle(g.discard.map((c) => (c.c === 'w' ? { c: 'w', v: c.v } : c)));
      g.discard = [t];
      if (!g.deck.length) break; // kartu benar-benar habis
    }
    got.push(g.deck.pop());
  }
  return got;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(games));
  } catch (e) {
    console.error('[uno] simpan:', e.message);
  }
}

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) games = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {};
  } catch {
    games = {};
  }
}

const mention = (p) => `@${user(p.mention)}`;
// hanya yang namanya di-tag di teks yang mendapat notifikasi (biasanya pemain yang sedang giliran)
const mentionsIn = (g, text) => g.players.filter((p) => text.includes('@' + user(p.mention))).map((p) => p.mention);
async function sendGroup(g, text, extra = {}) {
  if (!SOCK) return;
  try {
    await SOCK.sendMessage(g.group, { text, mentions: mentionsIn(g, text), ...extra });
  } catch (e) {
    console.error('[uno] kirim grup:', e.message);
  }
}
async function sendDM(p, text) {
  if (!SOCK) return false;
  try {
    await SOCK.sendMessage(p.dm, { text });
    return true;
  } catch (e) {
    console.error('[uno] kirim DM:', e.message);
    return false;
  }
}

function event(g, text) {
  g.seq = (g.seq || 0) + 1;
  g.events.push({ s: g.seq, t: text });
  if (g.events.length > 40) g.events.shift();
}

/* ================= tampilan ================= */
function handText(g, p, mark = true) {
  return p.hand.map((c, i) => `${i + 1}. ${cardText(c)}${mark && canPlay(g, c) ? '  ✅' : ''}`).join('\n');
}

function tableText(g, headline = '') {
  const p = cur(g);
  const others = [];
  for (let s = 1; s < g.players.length; s++) {
    const q = g.players[nextIndex(g, s)];
    others.push(`${q.name} (${q.hand.length})`);
  }
  const col = top(g).c === 'w' ? ` → warna ${COLORS[g.color]} ${COLOR_NAME[g.color]}` : '';
  return (
    (headline ? headline + '\n\n' : '') +
    `🃏 Kartu atas: *${cardText(top(g))}*${col}\n` +
    `Arah: ${g.dir === 1 ? '➡️' : '⬅️'}\n` +
    `Giliran: ${mention(p)} (${p.hand.length} kartu) · ${TURN_SECONDS} dtk\n` +
    (others.length ? `Berikutnya: ${others.join(' · ')}` : '')
  );
}

async function sendTurnDM(g) {
  const p = cur(g);
  const news = g.events.filter((e) => e.s > (p.seen || 0)).slice(-8).map((e) => '• ' + e.t);
  p.seen = g.seq;
  const col = top(g).c === 'w' ? ` (warna ${COLOR_NAME[g.color]})` : '';
  const txt =
    `🃏 *Giliranmu!* (${g.groupName || 'grup'})\n` +
    (news.length ? `Sejak giliranmu terakhir:\n${news.join('\n')}\n\n` : '\n') +
    `Kartu atas: *${cardText(top(g))}*${col}\n` +
    `Kartumu (${p.hand.length}):\n${handText(g, p)}\n\n` +
    `Balas di sini atau di grup:\n• *nomor* kartu, mis. *2*\n• Wild: *4 merah* (merah/biru/hijau/kuning)\n• *ambil* — ambil 1 kartu\n` +
    (p.hand.length === 2 ? `• Kartu tinggal 2: ketik *uno* sebelum/sesudah main biar tidak ditangkap!\n` : '') +
    `_Waktu ${TURN_SECONDS} detik_`;
  await sendDM(p, txt);
}

/* ================= alur ================= */
function startTurn(g) {
  g.drew = false;
  g.deadline = Date.now() + TURN_SECONDS * 1000;
}

async function advance(g, steps = 1, headline = '') {
  g.turn = nextIndex(g, steps);
  startTurn(g);
  save();
  await sendGroup(g, tableText(g, headline));
  await sendTurnDM(g);
}

async function finish(g, winner, why = '') {
  const lines = g.players.filter((p) => p !== winner).map((p) => `• ${mention(p)}: ${p.hand.length} kartu`);
  delete games[g.group];
  save();
  await sendGroup(g, `🏆 *${mention(winner)} MENANG UNO!*${why ? '\n' + why : ''}\n\nSisa kartu:\n${lines.join('\n') || '-'}\n\nMain lagi: *.uno buat*`);
}

async function removePlayer(g, idx, reason) {
  const p = g.players[idx];
  g.deck.unshift(...p.hand);
  g.players.splice(idx, 1);
  if (g.unoPending === p.key) g.unoPending = null;
  if (g.phase !== 'play') { save(); return; }
  if (g.players.length < 2) {
    if (g.players.length === 1) return finish(g, g.players[0], `${p.name} ${reason}.`);
    delete games[g.group]; save(); return;
  }
  const wasTurn = idx === g.turn;
  const n = g.players.length;
  if (idx < g.turn) g.turn -= 1;
  else if (wasTurn) g.turn = g.dir === 1 ? g.turn % n : (g.turn - 1 + n) % n;
  if (wasTurn) startTurn(g);
  save();
  await sendGroup(g, tableText(g, `🚪 ${p.name} ${reason}.`));
  if (wasTurn) await sendTurnDM(g);
}

/* ================= API untuk plugin ================= */
export function setSock(sock) {
  SOCK = sock;
  if (!ticker) {
    load();
    ticker = setInterval(tick, 5000);
    ticker.unref?.();
  }
}

export const getGame = (group) => games[group] || null;

export function findPlayerGame(mi) {
  const ids = idsOf(mi);
  if (mi.isGroup) {
    const g = games[mi.remoteJid];
    if (!g) return null;
    const p = g.players.find((x) => x.ids.some((i) => ids.includes(i)));
    return p ? { g, p } : { g, p: null };
  }
  for (const g of Object.values(games)) {
    if (g.phase !== 'play') continue;
    const p = g.players.find((x) => x.ids.some((i) => ids.includes(i)));
    if (p) return { g, p };
  }
  return null;
}

function makePlayer(mi) {
  const ids = idsOf(mi);
  const dm = ids.find((i) => i.endsWith('@s.whatsapp.net')) || ids.find((i) => i.endsWith('@lid')) || normJid(mi.sender);
  return { key: ids[0] || normJid(mi.sender), ids, dm, mention: normJid(mi.sender), name: mi.pushName || user(mi.sender), hand: [], afk: 0, seen: 0, saidUno: false };
}

export function createLobby(mi, groupName) {
  if (games[mi.remoteJid]) return { err: games[mi.remoteJid].phase === 'lobby' ? 'Sudah ada lobi UNO. Ketik *.uno join* untuk ikut.' : 'Game UNO sedang berjalan di grup ini.' };
  const host = makePlayer(mi);
  games[mi.remoteJid] = { group: mi.remoteJid, groupName, phase: 'lobby', host: host.key, players: [host], createdAt: Date.now(), events: [], seq: 0, dir: 1, turn: 0, deck: [], discard: [], color: null, unoPending: null };
  save();
  return { g: games[mi.remoteJid] };
}

export function joinLobby(mi) {
  const g = games[mi.remoteJid];
  if (!g) return { err: 'Belum ada lobi. Buat dulu: *.uno buat*' };
  if (g.phase !== 'lobby') return { err: 'Game sudah dimulai, tunggu ronde berikutnya.' };
  const ids = idsOf(mi);
  if (g.players.some((p) => p.ids.some((i) => ids.includes(i)))) return { err: 'Kamu sudah ikut.' };
  if (g.players.length >= MAX_PLAYERS) return { err: `Lobi penuh (${MAX_PLAYERS} pemain).` };
  g.players.push(makePlayer(mi));
  save();
  return { g };
}

export async function leave(mi) {
  const f = findPlayerGame(mi);
  if (!f?.p) return { err: 'Kamu tidak sedang ikut UNO di grup ini.' };
  const idx = f.g.players.indexOf(f.p);
  if (f.g.phase === 'lobby') {
    f.g.players.splice(idx, 1);
    if (!f.g.players.length || f.p.key === f.g.host) { delete games[f.g.group]; save(); return { msg: '🚪 Lobi UNO dibubarkan.' }; }
    save();
    return { msg: `🚪 ${f.p.name} keluar dari lobi.` };
  }
  await removePlayer(f.g, idx, 'keluar dari permainan');
  return { msg: null };
}

export async function startGame(mi) {
  const g = games[mi.remoteJid];
  if (!g) return { err: 'Belum ada lobi. Buat dulu: *.uno buat*' };
  if (g.phase !== 'lobby') return { err: 'Game sudah berjalan.' };
  if (!idsOf(mi).includes(g.host)) return { err: 'Hanya pembuat lobi yang bisa memulai.' };
  if (g.players.length < 2) return { err: 'Minimal 2 pemain. Ajak teman: *.uno join*' };
  g.phase = 'play';
  g.deck = newDeck();
  shuffle(g.players);
  for (const p of g.players) p.hand = draw(g, HAND_SIZE);
  // kartu pertama di meja harus kartu angka
  let first;
  do {
    first = g.deck.pop();
    if (!/^\d$/.test(first.v)) g.deck.unshift(first);
  } while (!/^\d$/.test(first.v));
  g.discard = [first];
  g.color = first.c;
  g.turn = 0;
  g.dir = 1;
  startTurn(g);
  save();
  for (const p of g.players) {
    if (p === cur(g)) continue;
    p.seen = g.seq;
    await sendDM(p, `🃏 *UNO dimulai!* (${g.groupName || 'grup'})\nKartu atas: *${cardText(first)}*\n\nKartumu (${p.hand.length}):\n${handText(g, p, false)}\n\n_Tunggu giliranmu, nanti bot kabari di sini._`);
  }
  await sendGroup(g, tableText(g, `🎴 *UNO dimulai!* ${g.players.length} pemain, masing-masing ${HAND_SIZE} kartu.\nKartu dikirim lewat chat pribadi bot. Main dengan ketik *nomor kartu* di sini atau di chat bot.`));
  await sendTurnDM(g);
  return { g };
}

export async function stopGame(mi, isAdmin) {
  const g = games[mi.remoteJid];
  if (!g) return { err: 'Tidak ada game UNO di grup ini.' };
  if (!isAdmin && !idsOf(mi).includes(g.host)) return { err: 'Hanya pembuat game atau admin grup yang bisa menghentikan.' };
  delete games[mi.remoteJid];
  save();
  return { msg: '⏹️ Game UNO dihentikan.' };
}

export async function resendHand(mi) {
  const f = findPlayerGame(mi);
  if (!f?.p) return { err: 'Kamu tidak sedang ikut UNO.' };
  if (f.g.phase !== 'play') return { err: 'Game belum dimulai.' };
  const ok = await sendDM(f.p, `Kartu atas: *${cardText(top(f.g))}*\nKartumu (${f.p.hand.length}):\n${handText(f.g, f.p)}`);
  return { msg: ok ? '📩 Kartu dikirim ke chat pribadimu.' : '⚠️ Gagal kirim ke chat pribadi. Chat bot dulu sekali, lalu ulangi *.uno kartu*.' };
}

export function statusText(group) {
  const g = games[group];
  if (!g) return 'Tidak ada game UNO. Mulai: *.uno buat*';
  if (g.phase === 'lobby') return `🎴 Lobi UNO (${g.players.length}/${MAX_PLAYERS}):\n${g.players.map((p, i) => `${i + 1}. ${p.name}${p.key === g.host ? ' 👑' : ''}`).join('\n')}\n\nIkut: *.uno join* · Mulai (pembuat): *.uno mulai*`;
  return tableText(g);
}

/* ================= langkah permainan (teks bebas) ================= */
/**
 * Proses teks pemain. Mengembalikan { handled, reply } — reply dikirim ke chat asal.
 * handled=false berarti teks bukan perintah UNO (biarkan diproses handler lain).
 */
export async function move(mi, rawText) {
  const text = String(rawText || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const m = text.match(/^(\d{1,3})(?: (\S+))?$/);
  const word = ['ambil', 'lewat', 'pass', 'uno', 'tangkap'].includes(text) ? text : null;
  if (!m && !word) return { handled: false };
  const f = findPlayerGame(mi);
  if (!f?.p || f.g.phase !== 'play') return { handled: false };
  const { g, p } = f;
  const isTurn = cur(g) === p;

  if (word === 'tangkap') {
    const v = g.players.find((x) => x.key === g.unoPending);
    if (!v) return { handled: true, reply: 'Tidak ada yang bisa ditangkap.' };
    if (v === p) return { handled: true, reply: 'Masa nangkap diri sendiri 😅 ketik *uno*.' };
    v.hand.push(...draw(g, 2));
    g.unoPending = null;
    event(g, `${p.name} menangkap ${v.name} lupa UNO → +2`);
    save();
    await sendGroup(g, `🚨 ${mention(p)} menangkap ${mention(v)} lupa bilang UNO! ${v.name} ambil 2 kartu.`);
    await sendDM(v, `🚨 Kamu ditangkap lupa bilang UNO, +2 kartu.\nKartumu (${v.hand.length}):\n${handText(g, v, false)}`);
    return { handled: true };
  }

  if (word === 'uno') {
    if (g.unoPending === p.key) {
      g.unoPending = null;
      save();
      await sendGroup(g, `📣 ${mention(p)}: *UNO!*`);
      return { handled: true };
    }
    if (p.hand.length === 2 && isTurn) {
      p.saidUno = true;
      save();
      return { handled: true, reply: '📣 UNO! Sekarang mainkan kartumu.' };
    }
    return { handled: true, reply: p.hand.length <= 2 ? 'Bilang *uno* saat kartumu tinggal 2 (giliranmu) atau tinggal 1.' : 'Kartumu masih banyak 😄' };
  }

  // sisa perintah hanya untuk yang sedang giliran (yang bukan giliran: diam)
  if (!isTurn) return mi.isGroup ? { handled: false } : { handled: true, reply: `Belum giliranmu. Sekarang giliran ${cur(g).name}.` };

  // pemain yang lupa UNO aman kalau pemain berikutnya sudah bergerak
  const clearPending = () => { if (g.unoPending && g.unoPending !== p.key) g.unoPending = null; };

  if (word === 'ambil') {
    if (g.drew) return { handled: true, reply: 'Kamu sudah ambil. Mainkan kartu yang bisa, atau ketik *lewat*.' };
    clearPending();
    const [c] = draw(g, 1);
    if (!c) return { handled: true, reply: 'Kartu habis, ketik *lewat*.' };
    p.hand.push(c);
    p.afk = 0;
    g.drew = true;
    event(g, `${p.name} ambil 1 kartu`);
    if (canPlay(g, c)) {
      save();
      return { handled: true, reply: `Dapat *${cardText(c)}* (nomor ${p.hand.length}) ✅ bisa dimainkan.\nKetik *${p.hand.length}*${c.c === 'w' ? ' merah/biru/hijau/kuning' : ''} untuk main, atau *lewat*.` };
    }
    await advance(g, 1, `📥 ${p.name} ambil kartu dan lewat.`);
    return { handled: true, reply: mi.isGroup ? null : `Dapat *${cardText(c)}*, tidak bisa dimainkan → lewat.` };
  }

  if (word === 'lewat' || word === 'pass') {
    if (!g.drew) return { handled: true, reply: 'Ambil kartu dulu (*ambil*) sebelum lewat.' };
    clearPending();
    p.afk = 0;
    event(g, `${p.name} lewat`);
    await advance(g, 1, `⏭️ ${p.name} lewat.`);
    return { handled: true };
  }

  // main kartu
  const i = Number(m[1]) - 1;
  const card = p.hand[i];
  if (!card) return { handled: true, reply: `Nomor ${m[1]} tidak ada. Kartumu 1–${p.hand.length}.` };
  if (g.drew && i !== p.hand.length - 1) return { handled: true, reply: `Setelah ambil, hanya kartu yang baru diambil (nomor ${p.hand.length}) yang boleh dimainkan, atau ketik *lewat*.` };
  if (!canPlay(g, card)) return { handled: true, reply: `${cardText(card)} tidak bisa di atas ${cardText(top(g))}${top(g).c === 'w' ? ' (' + COLOR_NAME[g.color] + ')' : ''}.` };
  let color = card.c;
  if (card.c === 'w') {
    color = COLOR_INPUT[m[2] || ''];
    if (!color) return { handled: true, reply: `Pilih warna: *${m[1]} merah* / *${m[1]} biru* / *${m[1]} hijau* / *${m[1]} kuning*` };
  } else if (m[2]) {
    return { handled: false }; // "3 orang" dsb. bukan langkah
  }

  clearPending();
  p.hand.splice(i, 1);
  g.discard.push(card);
  g.color = color;
  p.afk = 0;
  const wildTxt = card.c === 'w' ? ` → ${COLORS[color]} ${COLOR_NAME[color]}` : '';
  event(g, `${p.name} main ${cardText(card)}${wildTxt}`);

  if (!p.hand.length) {
    await finish(g, p);
    return { handled: true };
  }
  if (p.hand.length === 1 && !p.saidUno) g.unoPending = p.key;
  p.saidUno = false;

  let head = `🎴 ${p.name} main *${cardText(card)}*${wildTxt}`;
  if (p.hand.length === 1) head += g.unoPending === p.key ? `\n⚠️ ${p.name} tinggal 1 kartu dan belum bilang UNO — ketik *tangkap*!` : `\n📣 ${p.name}: UNO!`;
  const n = g.players.length;
  if (card.v === 'skip') {
    const v = g.players[nextIndex(g, 1)];
    event(g, `${v.name} dilewati`);
    await advance(g, 2, head + `\n⛔ ${v.name} dilewati.`);
  } else if (card.v === 'rev') {
    g.dir *= -1;
    if (n === 2) await advance(g, 2, head + '\n🔄 Arah berbalik (2 pemain = main lagi).');
    else await advance(g, 1, head + '\n🔄 Arah berbalik.');
  } else if (card.v === '+2' || card.v === '+4') {
    const k = card.v === '+2' ? 2 : 4;
    const v = g.players[nextIndex(g, 1)];
    v.hand.push(...draw(g, k));
    event(g, `${v.name} ambil ${k} kartu dan dilewati`);
    await advance(g, 2, head + `\n➕ ${v.name} ambil ${k} kartu dan dilewati.`);
  } else {
    await advance(g, 1, head);
  }
  return { handled: true, reply: mi.isGroup ? null : `✅ Kamu main ${cardText(card)}${wildTxt}. Sisa ${p.hand.length} kartu.` };
}

/* ================= timer ================= */
async function tick() {
  const now = Date.now();
  for (const g of Object.values(games)) {
    try {
      if (g.phase === 'lobby') {
        if (now - g.createdAt > LOBBY_MINUTES * 60000) {
          delete games[g.group];
          save();
          await sendGroup(g, '⌛ Lobi UNO dibatalkan (tidak dimulai dalam 5 menit).');
        }
        continue;
      }
      if (!g.deadline || now < g.deadline) continue;
      const p = cur(g);
      p.afk = (p.afk || 0) + 1;
      if (p.afk >= AFK_LIMIT) {
        await removePlayer(g, g.turn, `dikeluarkan (${AFK_LIMIT}x tidak main)`);
        continue;
      }
      if (!g.drew) p.hand.push(...draw(g, 1));
      event(g, `${p.name} kehabisan waktu`);
      await advance(g, 1, `⌛ ${p.name} kehabisan waktu${g.drew ? '' : ', ambil 1 kartu'} (${p.afk}/${AFK_LIMIT}).`);
    } catch (e) {
      console.error('[uno] tick:', e.message);
    }
  }
}

// untuk pengujian
export const _test = { games: () => games, reset: () => { games = {}; }, tick, newDeck, canPlay, setDeadline: (group, t) => { games[group].deadline = t; } };
