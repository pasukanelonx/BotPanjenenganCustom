// Perbarui link undangan grup XChat yang dikirim .kiw join (tanpa mengubah config.js / redeploy).
//   .mglink                       -> daftar link yang dipakai sekarang
//   .mglink 3 https://x.com/i/chat/group_join/g…/…     -> ganti link grup nomor 3
//   .mglink <link> <link> …       -> tanpa nomor: dicocokkan otomatis lewat ID grup (g…) di link
//   .mglink semua <6 link berurutan sesuai nomor>
//   .mglink reset 3               -> kembali ke link bawaan config.js
import { mg, whoIs, isMgAdmin } from '../../lib/memberGuard.js';
import { getGrupJoin, setGrupLink, resetGrupLink, LINK_RE } from '../../lib/grupJoin.js';

const gid = (link) => (String(link || '').match(LINK_RE) || [])[1] || null;
const tgl = (iso) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix } = messageInfo;
  const send = (text) => sock.sendMessage(remoteJid, { text, linkPreview: null }, { quoted: message });
  try {
    await mg();
    const who = await whoIs(sock, messageInfo);
    if (!(await isMgAdmin(sock, messageInfo, who))) return send('_⛔ Perintah ini khusus admin._');
    const by = (who.pn || who.lid || messageInfo.sender || '').split('@')[0];
    const words = String(content || '').trim().split(/\s+/).filter(Boolean);
    const list = getGrupJoin();

    const daftar = () => [
      '*Link grup XChat untuk .kiw join*', '',
      ...list.map((g) => `${g.no}. *${g.nama}*${g.diubah ? ` _(diubah ${tgl(g.diubah)})_` : ''}\n${g.link}`),
      '',
      `Ganti satu: *${prefix}mglink 3 LINK*`,
      `Ganti beberapa sekaligus: *${prefix}mglink LINK LINK …* (dicocokkan otomatis lewat ID grup)`,
      `Ganti semua berurutan: *${prefix}mglink semua LINK1 LINK2 … LINK${list.length}*`,
      `Kembalikan ke bawaan: *${prefix}mglink reset 3*`,
    ].join('\n');

    if (!words.length) return send(daftar());

    const a0 = words[0].toLowerCase();
    if (a0 === 'reset') {
      const nos = words.slice(1).map(Number).filter(Boolean);
      if (!nos.length) return send(`Contoh: *${prefix}mglink reset 3*`);
      const done = nos.filter((n) => resetGrupLink(n));
      return send(done.length ? `↩️ Kembali ke link bawaan: ${done.map((n) => `#${n}`).join(', ')}` : 'Tidak ada yang perlu dikembalikan.');
    }

    const hasil = [];
    const gagal = [];
    const apply = (no, link) => {
      const g = list.find((x) => x.no === Number(no));
      const r = setGrupLink(no, link, by);
      if (r.ok) hasil.push(`✅ ${no}. ${g?.nama || ''}${r.beda ? ' ⚠️ ID grup berbeda dari link lama, pastikan grupnya benar' : ''}`);
      else gagal.push(`❌ ${no}: ${r.error}`);
    };

    if (a0 === 'semua') {
      const links = words.slice(1).filter((w) => LINK_RE.test(w.replace(/[?#].*$/, '')));
      if (links.length !== list.length) return send(`Untuk *semua*, kirim tepat ${list.length} link berurutan sesuai nomor (terbaca ${links.length}).\nKetik *${prefix}mglink* untuk melihat urutannya.`);
      list.forEach((g, i) => apply(g.no, links[i]));
    } else {
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (/^\d+$/.test(w)) {
          const next = words[i + 1];
          if (!next) { gagal.push(`❌ ${w}: link-nya belum ditulis`); continue; }
          apply(Number(w), next);
          i++;
        } else if (gid(w.replace(/[?#].*$/, ''))) {
          // tanpa nomor: cari grup dengan ID yang sama
          const id = gid(w.replace(/[?#].*$/, ''));
          const g = list.find((x) => gid(x.link) === id);
          if (g) apply(g.no, w);
          else gagal.push(`❌ ${w.slice(0, 60)}…: ID grup g${id} tidak cocok dengan grup mana pun, tulis nomornya: *${prefix}mglink NOMOR LINK*`);
        } else {
          gagal.push(`❌ "${w.slice(0, 40)}" bukan nomor atau link undangan grup XChat`);
        }
      }
    }
    if (!hasil.length && !gagal.length) return send(daftar());
    return send([
      hasil.length ? `*Link diperbarui (${hasil.length})*\n${hasil.join('\n')}` : null,
      gagal.length ? gagal.join('\n') : null,
      hasil.length ? `\n_.kiw join langsung memakai link baru. Cek: ${prefix}mglink_` : null,
    ].filter(Boolean).join('\n'));
  } catch (e) {
    console.error('[mglink]', e);
    return send(`_⚠️ Gagal: ${e.message}_`);
  }
}

export default {
  handle,
  Commands: ['mglink'],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 0,
};
