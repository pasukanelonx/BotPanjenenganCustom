// Werewolf untuk grup WhatsApp (5–15 pemain).
// Peran dibagikan lewat chat pribadi. MALAM: peran khusus beraksi lewat chat pribadi bot dengan mengetik nomor pemain.
// SIANG: korban diumumkan, warga berdiskusi, lalu voting di grup dengan "vote 3". Kode ditulis ulang dari nol
// (kode Werewolf lama disamarkan), aturan & pembagian peran mengikuti versi sebelumnya.
import fs from 'fs';
import path from 'path';
import { idsOf, normJid } from './unoGame.js';

const STATE_FILE = path.join(process.cwd(), 'database', 'temporary_db', 'werewolf-state.json');
const NIGHT_SECONDS = 90;
const DAY_SECONDS = 150; // diskusi + voting
const LOBBY_MINUTES = 10;
const MIN_PLAYERS = 5;
const MAX_PLAYERS = 15;

export const ROLES = {
  werewolf: { name: 'Werewolf', emoji: '🐺', team: 'ww' },
  sorcerer: { name: 'Penyihir', emoji: '🧙', team: 'ww' },
  seer: { name: 'Penerawang', emoji: '🔮', team: 'warga' },
  guardian: { name: 'Malaikat Pelindung', emoji: '👼', team: 'warga' },
  warga: { name: 'Warga Desa', emoji: '👨‍🌾', team: 'warga' },
};
// jumlah peran per jumlah pemain [werewolf, penerawang, pelindung, penyihir] — sisanya warga
const TABLE = { 5: [1, 1, 1, 0], 6: [2, 1, 1, 0], 7: [2, 1, 1, 0], 8: [2, 1, 1, 0], 9: [2, 1, 1, 1], 10: [2, 1, 1, 1], 11: [2, 1, 2, 1], 12: [2, 1, 2, 1], 13: [2, 1, 1, 1], 14: [2, 2, 2, 1], 15: [3, 2, 3, 1] };

let games = {};
let SOCK = null;
let ticker = null;

/* ================= util ================= */
const user = (j) => normJid(j).split('@')[0];
const tag = (p) => `@${user(p.mention)}`;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const roleLabel = (r) => `${ROLES[r].emoji} ${ROLES[r].name}`;
const alive = (g) => g.players.filter((p) => p.alive);
const byNum = (g, n) => g.players.find((p) => p.num === n);
const isWolfTeam = (p) => ROLES[p.role]?.team === 'ww';

function save() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(games));
  } catch (e) {
    console.error('[ww] simpan:', e.message);
  }
}
function load() {
  try {
    if (fs.existsSync(STATE_FILE)) games = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {};
  } catch {
    games = {};
  }
}
async function sendGroup(g, text, extraMentions = []) {
  if (!SOCK) return;
  try {
    const m = g.players.filter((p) => text.includes('@' + user(p.mention))).map((p) => p.mention);
    await SOCK.sendMessage(g.group, { text, mentions: [...new Set([...m, ...extraMentions])] });
  } catch (e) {
    console.error('[ww] kirim grup:', e.message);
  }
}
async function sendDM(p, text) {
  if (!SOCK) return false;
  try {
    await SOCK.sendMessage(p.dm, { text });
    return true;
  } catch (e) {
    console.error('[ww] kirim DM:', e.message);
    return false;
  }
}
function makePlayer(mi) {
  const ids = idsOf(mi);
  const dm = ids.find((i) => i.endsWith('@s.whatsapp.net')) || ids.find((i) => i.endsWith('@lid')) || normJid(mi.sender);
  return { key: ids[0] || normJid(mi.sender), ids, dm, mention: normJid(mi.sender), name: mi.pushName || user(mi.sender), num: 0, role: null, alive: true };
}
const findIn = (g, mi) => {
  const ids = idsOf(mi);
  return g.players.find((p) => p.ids.some((i) => ids.includes(i))) || null;
};
function findPlayerGame(mi) {
  if (mi.isGroup) {
    const g = games[mi.remoteJid];
    return g ? { g, p: findIn(g, mi) } : null;
  }
  for (const g of Object.values(games)) {
    if (g.phase === 'lobby') continue;
    const p = findIn(g, mi);
    if (p) return { g, p };
  }
  return null;
}

/* ================= tampilan ================= */
function listText(g, viewer = null) {
  return g.players.map((p) => {
    let extra = '';
    if (!p.alive) extra = ` ☠️ ${roleLabel(p.role)}`;
    else if (viewer && isWolfTeam(viewer) && isWolfTeam(p) && p !== viewer) extra = ` (${roleLabel(p.role)})`;
    return `${p.num}. ${p.name}${p === viewer ? ' (kamu)' : ''}${extra}`;
  }).join('\n');
}
const ACTION = {
  werewolf: 'Ketik *nomor* pemain yang ingin kamu *mangsa* malam ini.',
  seer: 'Ketik *nomor* pemain yang ingin kamu *terawang* perannya.',
  guardian: 'Ketik *nomor* pemain yang ingin kamu *lindungi* malam ini.',
  sorcerer: 'Ketik *nomor* pemain yang ingin kamu *intip* perannya. Kamu satu tim dengan Werewolf.',
  warga: 'Kamu tidak punya aksi malam. Tidur yang nyenyak dan ikut berdiskusi saat siang.',
};
async function sendNightDM(g, p) {
  await sendDM(p, `🌙 *Malam ke-${g.day}* (${g.groupName || 'grup'})\nPeranmu: *${roleLabel(p.role)}*\n\n${listText(g, p)}\n\n${ACTION[p.role]}\n_Waktu ${NIGHT_SECONDS} detik. Ketik di chat ini._`);
}

/* ================= API plugin ================= */
export function setSock(sock) {
  SOCK = sock;
  if (!ticker) {
    load();
    ticker = setInterval(tick, 3000);
    ticker.unref?.();
  }
}
export const getGame = (group) => games[group] || null;

export function create(mi, groupName) {
  if (games[mi.remoteJid]) return { err: games[mi.remoteJid].phase === 'lobby' ? 'Sudah ada lobi. Ketik *.ww join* untuk ikut.' : 'Werewolf sedang berjalan di grup ini.' };
  const p = makePlayer(mi);
  games[mi.remoteJid] = { group: mi.remoteJid, groupName, phase: 'lobby', host: p.key, players: [p], day: 0, deadline: 0, createdAt: Date.now(), night: null, votes: {}, lastGuard: {} };
  save();
  return { g: games[mi.remoteJid] };
}
export function join(mi) {
  const g = games[mi.remoteJid];
  if (!g) return { err: 'Belum ada lobi. Buat dulu: *.ww buat*' };
  if (g.phase !== 'lobby') return { err: 'Permainan sudah berjalan, tunggu ronde berikutnya.' };
  if (findIn(g, mi)) return { err: 'Kamu sudah ikut.' };
  if (g.players.length >= MAX_PLAYERS) return { err: `Lobi penuh (${MAX_PLAYERS} pemain).` };
  g.players.push(makePlayer(mi));
  save();
  return { g };
}
export function lobbyText(g) {
  return `🐺 *W E R E W O L F*\n\nPemain (${g.players.length}/${MAX_PLAYERS}):\n${g.players.map((p, i) => `${i + 1}. ${tag(p)}${p.key === g.host ? ' 👑' : ''}`).join('\n')}\n\nIkut: *.ww join* · Mulai (pembuat): *.ww mulai*\nMinimal ${MIN_PLAYERS} pemain. _Lobi batal otomatis setelah ${LOBBY_MINUTES} menit._\n\n⚠️ Setiap pemain harus pernah chat pribadi ke bot (misalnya ketik *.menu* di chat bot) supaya bisa menerima peran.`;
}

export async function start(mi) {
  const g = games[mi.remoteJid];
  if (!g) return { err: 'Belum ada lobi. Buat dulu: *.ww buat*' };
  if (g.phase !== 'lobby') return { err: 'Permainan sudah berjalan.' };
  const me = findIn(g, mi);
  if (!me || me.key !== g.host) return { err: 'Hanya pembuat lobi yang bisa memulai.' };
  if (g.players.length < MIN_PLAYERS) return { err: `Minimal ${MIN_PLAYERS} pemain (sekarang ${g.players.length}).` };
  const [w, s, gu, so] = TABLE[g.players.length];
  const roles = shuffle([...Array(w).fill('werewolf'), ...Array(s).fill('seer'), ...Array(gu).fill('guardian'), ...Array(so).fill('sorcerer'),
    ...Array(g.players.length - w - s - gu - so).fill('warga')]);
  shuffle(g.players).forEach((p, i) => { p.num = i + 1; p.role = roles[i]; p.alive = true; });
  g.players.sort((a, b) => a.num - b.num);
  const failed = [];
  for (const p of g.players) {
    const team = isWolfTeam(p) ? `\nTimmu: ${g.players.filter((x) => isWolfTeam(x) && x !== p).map((x) => `${x.num}. ${x.name} (${roleLabel(x.role)})`).join(', ') || '-'}` : '';
    const ok = await sendDM(p, `🐺 *WEREWOLF dimulai!* (${g.groupName || 'grup'})\nPeranmu: *${roleLabel(p.role)}*${team}\n\nRahasiakan peranmu. Aksi malam diketik di chat ini, voting siang diketik di grup.`);
    if (!ok) failed.push(p);
  }
  const counts = Object.entries(roles.reduce((a, r) => ((a[r] = (a[r] || 0) + 1), a), {})).map(([r, n]) => `${ROLES[r].emoji}${n}`).join(' ');
  await sendGroup(g, `🐺 *Werewolf dimulai!* ${g.players.length} pemain · ${counts}\nPeran sudah dikirim lewat chat pribadi bot.${failed.length ? `\n⚠️ Gagal kirim ke: ${failed.map(tag).join(', ')} — chat bot dulu lalu ketik *.ww peran*.` : ''}\n\n${listText(g)}`);
  await startNight(g);
  return { g };
}

async function startNight(g) {
  g.phase = 'night';
  g.day += 1;
  g.night = { wolf: {}, seer: {}, guard: {}, sorc: {} };
  g.deadline = Date.now() + NIGHT_SECONDS * 1000;
  save();
  await sendGroup(g, `🌙 *Malam ke-${g.day}*. Semua warga masuk rumah...\nPeran khusus beraksi lewat chat pribadi bot (${NIGHT_SECONDS} detik).`);
  for (const p of alive(g)) if (p.role !== 'warga') await sendNightDM(g, p);
}

function nightDone(g) {
  const need = alive(g).filter((p) => p.role !== 'warga');
  const n = g.night;
  return need.every((p) => (p.role === 'werewolf' && n.wolf[p.key]) || (p.role === 'seer' && n.seer[p.key]) || (p.role === 'guardian' && n.guard[p.key]) || (p.role === 'sorcerer' && n.sorc[p.key]));
}

/** Aksi malam lewat chat pribadi: pemain mengetik nomor target. */
export async function nightAction(mi, num) {
  const f = findPlayerGame(mi);
  if (!f?.p || f.g.phase !== 'night') return { handled: false };
  const { g, p } = f;
  if (!p.alive) return { handled: true, reply: '☠️ Kamu sudah mati.' };
  if (p.role === 'warga') return { handled: true, reply: 'Warga tidak punya aksi malam. Tunggu pagi ya.' };
  const t = byNum(g, num);
  if (!t) return { handled: true, reply: `Nomor ${num} tidak ada.` };
  if (!t.alive) return { handled: true, reply: `${t.name} sudah mati.` };
  const n = g.night;
  let reply;
  if (p.role === 'werewolf') {
    if (isWolfTeam(t)) return { handled: true, reply: 'Tidak bisa memangsa teman setim.' };
    n.wolf[p.key] = num;
    reply = `🐺 Kamu memilih memangsa *${t.num}. ${t.name}*. Bisa diganti sebelum pagi.`;
    for (const w of alive(g).filter((x) => x.role === 'werewolf' && x !== p)) await sendDM(w, `🐺 ${p.name} memilih memangsa ${t.num}. ${t.name}.`);
  } else if (p.role === 'seer' || p.role === 'sorcerer') {
    const slot = p.role === 'seer' ? n.seer : n.sorc;
    if (slot[p.key]) return { handled: true, reply: 'Kamu sudah memakai kemampuanmu malam ini.' };
    if (t === p) return { handled: true, reply: 'Pilih pemain lain.' };
    slot[p.key] = num;
    reply = `${ROLES[p.role].emoji} *${t.num}. ${t.name}* adalah *${roleLabel(t.role)}*.`;
  } else if (p.role === 'guardian') {
    if (g.lastGuard[p.key] === num) return { handled: true, reply: 'Tidak bisa melindungi orang yang sama dua malam berturut-turut.' };
    n.guard[p.key] = num;
    reply = `👼 Kamu melindungi *${t.num}. ${t.name}* malam ini.`;
  }
  save();
  if (nightDone(g)) g.deadline = Date.now() + 3000; // semua sudah beraksi → pagi lebih cepat
  return { handled: true, reply };
}

async function endNight(g) {
  const n = g.night;
  const counts = {};
  for (const num of Object.values(n.wolf)) counts[num] = (counts[num] || 0) + 1;
  let victim = null;
  const nums = Object.keys(counts).map(Number);
  if (nums.length) {
    const max = Math.max(...nums.map((x) => counts[x]));
    const top = nums.filter((x) => counts[x] === max);
    victim = byNum(g, top[Math.floor(Math.random() * top.length)]);
  }
  const guarded = new Set(Object.values(n.guard));
  g.lastGuard = { ...n.guard };
  let text = `☀️ *Pagi hari ke-${g.day}.*\n`;
  if (!victim) text += 'Malam berlalu dengan tenang, tidak ada korban.';
  else if (guarded.has(victim.num)) text += `${tag(victim)} hampir dimangsa Werewolf, tapi *Malaikat Pelindung* berhasil menyelamatkannya! 👼`;
  else {
    victim.alive = false;
    text += `Warga menemukan ${tag(victim)} tewas. Ia adalah *${roleLabel(victim.role)}*. ☠️`;
  }
  if (await checkWin(g, text)) return;
  g.phase = 'day';
  g.votes = {};
  g.deadline = Date.now() + DAY_SECONDS * 1000;
  save();
  await sendGroup(g, `${text}\n\n🗣️ Diskusi dan voting dibuka *${DAY_SECONDS} detik*. Siapa Werewolf-nya?\nKetik *vote nomor* di grup (bisa diganti). Pemain hidup:\n${alive(g).map((p) => `${p.num}. ${tag(p)}`).join('\n')}`);
}

/** Voting siang di grup: "vote 3". */
export async function vote(mi, num) {
  const g = games[mi.remoteJid];
  if (!g || g.phase !== 'day') return { handled: false };
  const p = findIn(g, mi);
  if (!p) return { handled: false };
  if (!p.alive) return { handled: true, reply: '☠️ Pemain yang sudah mati tidak bisa voting.' };
  const t = byNum(g, num);
  if (!t || !t.alive) return { handled: true, reply: `Nomor ${num} tidak ada atau sudah mati.` };
  g.votes[p.key] = num;
  save();
  const voted = Object.keys(g.votes).length;
  if (voted >= alive(g).length) g.deadline = Date.now() + 3000;
  return { handled: true, reply: `🗳️ ${p.name} → ${t.num}. ${t.name} (${voted}/${alive(g).length} sudah vote)` };
}

async function endDay(g) {
  const counts = {};
  for (const [k, num] of Object.entries(g.votes)) if (g.players.find((p) => p.key === k)?.alive) counts[num] = (counts[num] || 0) + 1;
  const nums = Object.keys(counts).map(Number);
  let text = '⚖️ *Hasil voting:* ';
  text += nums.length ? nums.sort((a, b) => counts[b] - counts[a]).map((x) => `${x}. ${byNum(g, x).name} (${counts[x]})`).join(', ') : 'tidak ada yang vote';
  const max = nums.length ? Math.max(...nums.map((x) => counts[x])) : 0;
  const top = nums.filter((x) => counts[x] === max);
  if (top.length === 1) {
    const t = byNum(g, top[0]);
    t.alive = false;
    text += `\n\n${tag(t)} dieksekusi warga. Ia adalah *${roleLabel(t.role)}*. ${isWolfTeam(t) ? '🎯' : '😢'}`;
  } else if (top.length > 1) text += '\n\nSuara seri, tidak ada yang dieksekusi.';
  if (await checkWin(g, text)) return;
  await sendGroup(g, text);
  await startNight(g);
}

async function checkWin(g, prefix) {
  const ww = alive(g).filter(isWolfTeam).length;
  const others = alive(g).length - ww;
  let winner = null;
  if (ww === 0) winner = 'warga';
  else if (ww >= others) winner = 'ww';
  if (!winner) return false;
  delete games[g.group];
  save();
  const roles = g.players.map((p) => `${p.num}. ${p.name} — ${roleLabel(p.role)}${p.alive ? '' : ' ☠️'}`).join('\n');
  await sendGroup(g, `${prefix}\n\n🏁 *${winner === 'warga' ? '👨‍🌾 WARGA DESA MENANG!' : '🐺 WEREWOLF MENANG!'}*\n\nPeran semua pemain:\n${roles}`);
  return true;
}

export async function leave(mi) {
  const g = games[mi.remoteJid];
  if (!g) return { err: 'Tidak ada Werewolf di grup ini.' };
  const p = findIn(g, mi);
  if (!p) return { err: 'Kamu tidak ikut.' };
  if (g.phase !== 'lobby') return { err: 'Permainan sudah dimulai, tidak bisa keluar. Minta pembuat lobi atau admin untuk *.ww stop*.' };
  g.players = g.players.filter((x) => x !== p);
  if (!g.players.length || p.key === g.host) { delete games[g.group]; save(); return { msg: '🚪 Lobi Werewolf dibubarkan.' }; }
  save();
  return { msg: `🚪 ${p.name} keluar dari lobi.` };
}
export async function stop(mi, isAdmin) {
  const g = games[mi.remoteJid];
  if (!g) return { err: 'Tidak ada Werewolf di grup ini.' };
  const p = findIn(g, mi);
  if (!isAdmin && (!p || p.key !== g.host)) return { err: 'Hanya pembuat lobi atau admin grup yang bisa menghentikan.' };
  delete games[g.group];
  save();
  return { msg: '⏹️ Werewolf dihentikan.' + (g.phase !== 'lobby' ? `\n\nPeran:\n${g.players.map((x) => `${x.num}. ${x.name} — ${roleLabel(x.role)}`).join('\n')}` : '') };
}
export async function resendRole(mi) {
  const f = findPlayerGame(mi);
  if (!f?.p || f.g.phase === 'lobby') return { err: 'Kamu tidak sedang bermain Werewolf.' };
  const { g, p } = f;
  const ok = g.phase === 'night' && p.alive && p.role !== 'warga' ? (await sendNightDM(g, p), true) : await sendDM(p, `Peranmu: *${roleLabel(p.role)}*\n\n${listText(g, p)}`);
  return { msg: ok ? '📩 Peran dikirim ke chat pribadimu.' : '⚠️ Gagal kirim. Chat bot dulu, lalu ulangi *.ww peran*.' };
}
export function statusText(group) {
  const g = games[group];
  if (!g) return 'Tidak ada Werewolf. Mulai: *.ww buat*';
  if (g.phase === 'lobby') return lobbyText(g);
  const left = Math.max(0, Math.round((g.deadline - Date.now()) / 1000));
  return `🐺 Werewolf — ${g.phase === 'night' ? `🌙 Malam ke-${g.day}` : `☀️ Siang ke-${g.day} (voting)`} · sisa ${left} detik\n\n${listText(g)}`;
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
          await sendGroup(g, '⌛ Lobi Werewolf dibatalkan (tidak dimulai).');
        }
        continue;
      }
      if (!g.deadline || now < g.deadline) continue;
      g.deadline = 0;
      if (g.phase === 'night') await endNight(g);
      else if (g.phase === 'day') await endDay(g);
    } catch (e) {
      console.error('[ww] tick:', e.message);
    }
  }
}

export const _test = { games: () => games, reset: () => { games = {}; }, tick, expire: (group) => { games[group].deadline = Date.now() - 1; } };
