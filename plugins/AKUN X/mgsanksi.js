// Sanksi bertingkat untuk akun yang belum konfirmasi sampai jam batas (data disimpan di member-guard).
//   .mgsanksi            -> reply pesan rekap: buat laporan sanksi (belum dijalankan)
//   .mgsanksi ok ID [-2] -> jalankan: catat strike + kick dari grup XChat (+ blacklist untuk strike terakhir)
//   .mgstrike            -> daftar strike;  .mgstrike hapus akun1 akun2 -> hapus strike / cabut sanksi
import { mg, whoIs, isMgAdmin } from '../../lib/memberGuard.js';

const JAM_BATAS = Number(process.env.SANKSI_JAM || 11); // jam WIB batas konfirmasi

const jamWib = () => new Date(Date.now() + 7 * 3600e3).getUTCHours();
const tagOf = (it) => (it.pn || it.lid ? '@' + String(it.pn || it.lid).split('@')[0] : null);

/** Ambil username yang belum ✅ dari pesan rekap (sama seperti .mgtag). */
function parseRekap(raw, util) {
  const perlu = [];
  for (const line of String(raw || '').split('\n')) {
    const t = line.trim();
    if (!t || /[✅☑✔]/u.test(t)) continue;
    if (/^\*[^*]+\*$/.test(t)) continue; // judul tebal
    const words = t.replace(/[*~`]/g, '').replace(/[❌✖✗❎⛔🚫]/gu, ' ').replace(/️/g, '').trim().split(/\s+/).filter(Boolean);
    if (words.length !== 1) continue;
    const u = util.normUser(words[0]) || util.normUser(words[0].replace(/^_+|_+$/g, ''));
    if (u && !perlu.includes(u)) perlu.push(u);
  }
  return perlu;
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, command, prefix } = messageInfo;
  const send = (text, mentions = []) => sock.sendMessage(remoteJid, { text, mentions }, { quoted: message });
  try {
    const { core, util } = await mg();
    const who = await whoIs(sock, messageInfo);
    if (!(await isMgAdmin(sock, messageInfo, who))) return send('_⛔ Perintah ini khusus admin._');
    const by = who.pn || who.lid || messageInfo.sender;
    const args = (content || '').trim().split(/\s+/).filter(Boolean);
    const a0 = (args[0] || '').toLowerCase();

    if (command === 'mgstrike') {
      if (a0 === 'hapus') {
        const { ok } = util.parseUsers(args.slice(1).join(' '));
        if (!ok.length) return send(`Contoh: *${prefix}mgstrike hapus akun1 akun2*`);
        const r = await core.sanksiHapus(ok, by);
        return send(r.removed.length ? `✅ Strike dihapus & sanksi dicabut: ${r.removed.map((u) => '@' + u).join(', ')}\n_Akun ini bisa minta link lagi lewat ${prefix}kiw → join._` : 'Akun itu tidak punya strike.');
      }
      const [rows, at] = await Promise.all([core.sanksiList(), core.sanksiAturan()]);
      if (!rows.length) return send(`👍 Belum ada akun yang punya strike.\n\nAturan: ${at.teks}.`);
      const lines = rows.map((r, i) => `${i + 1}. @${r.username} — strike ${r.strike}${r.aktif ? ` · ⛔ disanksi sampai ${r.untilText}` : ''}`);
      return send([`*Daftar strike (${rows.length})*`, '', ...lines, '', `Aturan: ${at.teks}.`, `Strike hangus kalau ${at.resetHari} hari tanpa strike baru.`, `Hapus: *${prefix}mgstrike hapus akun*`].join('\n'));
    }

    // .mgsanksi ok ID [-2 -5]
    if (a0 === 'ok' || /^\d+$/.test(a0)) {
      const id = Number(a0 === 'ok' ? args[1] : args[0]);
      if (!id) return send(`Contoh: *${prefix}mgsanksi ok 12*`);
      const exclude = args.slice(a0 === 'ok' ? 2 : 1).map((x) => Number(String(x).replace(/^-/, ''))).filter(Boolean);
      const r = await core.sanksiApply(id, exclude, by);
      if (r.error) return send(`❌ ${r.error}`);
      if (!r.done.length) return send('Tidak ada akun yang disanksi (semua dikecualikan).');
      const mentions = [];
      const lines = r.done.map((x, i) => {
        const tag = tagOf(x);
        if (x.pn || x.lid) mentions.push(x.pn || x.lid);
        return `${i + 1}. ${tag ? tag + ' → ' : ''}@${x.username} — strike ${x.strike}: ` +
          (x.permanen ? '*BLACKLIST PERMANEN*' : `keluar grup ${x.hari} hari, sampai ${x.untilText}`);
      });
      const kick = !r.kick ? '' : r.kick.queued
        ? `\n\n🦶 Kick grup XChat masuk antrean (laporan #${r.kick.id}). Hasilnya dikirim ke grup admin.`
        : `\n\n⚠️ Masih ada kick XChat lain di antrean. Setelah selesai jalankan: *${prefix}mgxkick ${r.kick.id}*`;
      return send([
        `⚖️ *Sanksi: tidak konfirmasi sampai jam ${JAM_BATAS}.00*`, '', ...lines, '',
        `_Selama masa sanksi akun tidak bisa minta link grup. Setelah selesai, minta lagi lewat ${prefix}kiw → join._`,
      ].join('\n') + kick, mentions);
    }

    // .mgsanksi (reply rekap / tempel daftar)
    const mm = message?.message || {};
    const ctx = Object.values(mm).find((v) => v && v.contextInfo && v.contextInfo.quotedMessage)?.contextInfo;
    const q = ctx?.quotedMessage || {};
    const quoted = q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || '';
    const paksa = a0 === 'paksa';
    const raw = (paksa ? args.slice(1).join('\n') : (content || '').trim()) || quoted;
    if (!raw.trim()) {
      const at = await core.sanksiAturan();
      return send([
        '*Sanksi tidak konfirmasi*',
        `Batas konfirmasi jam ${JAM_BATAS}.00 WIB. Aturan: ${at.teks}.`,
        '',
        `1. Reply pesan rekap terbaru dengan *${prefix}mgsanksi* → bot menyiapkan daftar (belum dijalankan)`,
        `2. Cek daftarnya, lalu *${prefix}mgsanksi ok ID* (kecualikan: *${prefix}mgsanksi ok ID -2 -5*)`,
        `3. *${prefix}mgstrike* — daftar strike · *${prefix}mgstrike hapus akun* — cabut`,
      ].join('\n'));
    }
    if (!paksa && jamWib() < JAM_BATAS) {
      return send(`⏰ Belum jam ${JAM_BATAS}.00 WIB, member masih boleh konfirmasi.\nKalau memang mau sekarang: *${prefix}mgsanksi paksa* (sambil reply rekap).`);
    }
    const perlu = parseRekap(raw, util);
    if (!perlu.length) return send('✅ Tidak ada username yang belum ✅ di pesan itu.');
    // username dengan _ di depan/belakang: pakai versi yang terdaftar
    const names = [];
    for (const u0 of perlu) {
      let u = u0;
      const alt = u0.replace(/^_+|_+$/g, '');
      if (alt && alt !== u0) {
        const i1 = await core.accountInfo(u0).catch(() => null);
        if (!i1?.owner) {
          const i2 = await core.accountInfo(alt).catch(() => null);
          if (i2?.owner) u = alt;
        }
      }
      if (!names.includes(u)) names.push(u);
    }
    const { report, lewati, aturan } = await core.sanksiPreview(names, by);
    const skipLines = lewati.length ? ['', 'Dilewati:', ...lewati.map((x) => `• @${x.username} — ${x.why}`)] : [];
    if (!report) return send(['Tidak ada akun yang perlu disanksi.', ...skipLines].join('\n'));
    const mentions = report.items.map((it) => it.pn || it.lid).filter(Boolean);
    const rows = report.items.map((it, i) =>
      `${i + 1}. @${it.username}${tagOf(it) ? ` (${tagOf(it)})` : ' (belum terdaftar)'} — strike ${it.strike} → ${it.permanen ? '*BLACKLIST PERMANEN*' : `keluar grup ${it.hari} hari`}`);
    return send([
      `⚖️ *Laporan #${report.id}: belum konfirmasi sampai jam ${JAM_BATAS}.00 (${report.items.length})*`, '', ...rows, ...skipLines, '',
      `Aturan: ${aturan}.`,
      `Jalankan: *${prefix}mgsanksi ok ${report.id}*`,
      `Kecualikan nomor urut (mis. yang izin): *${prefix}mgsanksi ok ${report.id} -2 -5*`,
      `Batalkan: *${prefix}mgbatal ${report.id}*`,
    ].join('\n'), mentions);
  } catch (e) {
    console.error('[member-guard] sanksi:', e);
    const old = /tidak diizinkan: sanksi/.test(e.message) ? '\n_member-guard di VPS belum dipasang fitur sanksi._' : '';
    return send(`_⚠️ Gagal: ${e.message}_${old}`);
  }
}

export default {
  handle,
  Commands: ['mgsanksi', 'mgstrike'],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 0,
};
