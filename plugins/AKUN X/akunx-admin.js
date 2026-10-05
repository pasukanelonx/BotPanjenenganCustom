// Perintah admin member-guard: status, scan, laporan, kick, dll.
import {
  mg, whoIs, isMgAdmin, groupMeta, memberGroups, memberMetas, findMember, syncWa, matchP, pnOf, lidOf, itemsUnregistered, executeKick, itemTag, ownerLabel,
} from '../../lib/memberGuard.js';

const HELP = (p) => [
  '*Admin Akun X*',
  `${p}mgstatus — ringkasan data`,
  `${p}mgcek — scan grup DM X sekarang`,
  `${p}mglaporan [id] — tampilkan laporan kick`,
  `${p}mgkick ID [-no …] [paksa] — eksekusi kick`,
  `${p}mgbatal ID — batalkan laporan`,
  `${p}mgbelum — member yang belum mendaftar akun X`,
  `${p}mgkickbelum — buat laporan kick untuk yang belum daftar`,
  `${p}mgpemilik akun — pemilik akun X`,
  `${p}mgtambah @member akun1 akun2 — daftarkan atas nama member`,
  `${p}mglepas akun — lepas akun dari pemiliknya`,
  `${p}mgidgrup — JID grup ini`,
].join('\n');

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, command, prefix, isGroup, mentionedJid } = messageInfo;
  const send = (text, mentions = []) => sock.sendMessage(remoteJid, { text, mentions }, { quoted: message });
  try {
    const { core, cfg, util } = await mg();
    const who = await whoIs(sock, messageInfo);
    if (!(await isMgAdmin(sock, messageInfo, who))) {
      if (command === 'mgidgrup' && isGroup) {
        const meta = await sock.groupMetadata(remoteJid);
        const p = meta.participants.find((x) => matchP(x, who));
        if (!p?.admin) return;
      } else return send('_⛔ Perintah ini khusus admin._');
    }
    const by = who.pn || who.lid || messageInfo.sender;
    const args = (content || '').trim().split(/\s+/).filter(Boolean);

    switch (command) {
      case 'mg':
      case 'mgmenu':
        return send(HELP(prefix));

      case 'mgidgrup': {
        if (!isGroup) return send('Kirim perintah ini di dalam grup.');
        const meta = await sock.groupMetadata(remoteJid);
        return send(`JID grup *${meta.subject}*:\n${remoteJid}`);
      }

      case 'mgstatus': {
        const s = await core.stats();
        return send([
          '*Status pendataan akun X*',
          `Pemilik aktif: ${s.owners} (keluar/dikick: ${s.ownersOut})`,
          `Akun terdaftar: ${s.accounts} — ada ${s.ada}, hilang ${s.hilang}, belum dicek ${s.baru}`,
          `Anggota grup DM terbaca: ${s.dm} (akun liar: ${s.liar})`,
          `Scan terakhir: ${s.lastScan ? `#${s.lastScan.id} ${s.lastScan.ok ? 'OK' : 'GAGAL'} ${util.fmtWib(s.lastScan.finished_at)}` : '-'}`,
          `Laporan pending: ${s.pending.map((r) => `#${r.id} (${r.kind})`).join(', ') || '-'}`,
          `Data anggota WA: ${s.wa?.at ? `${s.wa.n} orang, sinkron ${util.fmtWib(s.wa.at)}` : 'belum tersinkron'}`,
          `Grup WA ↔ grup XChat:${memberGroups(cfg).length ? '' : ' (WA_GROUPS belum diisi)'}`,
          ...await Promise.all((cfg.waGroups || []).map(async (f) => {
            const meta = await groupMeta(sock, f.jid).catch(() => null);
            return `• ${f.family}: ${meta?.subject || f.jid} (${meta?.participants?.length ?? '?'} anggota) ↔ ${f.keys.join(', ')}`;
          })),
        ].join('\n'));
      }

      case 'mgcek': {
        await syncWa(sock).catch(() => {});
        const j = await core.addJob('scan', { by });
        return send(j.duplicate ? 'Scan sudah dalam antrean.' : '🔎 Scan grup DM X masuk antrean. Hasilnya dikirim ke grup admin.');
      }

      case 'mglaporan': {
        const rep = args[0] ? await core.getReport(Number(args[0])) : await core.lastReport();
        if (!rep) return send('Belum ada laporan.');
        const { text, mentions } = await core.formatReportWa(rep);
        return send(`${text}\n\nStatus: *${rep.status}*`, mentions);
      }

      case 'mgbatal': {
        const rep = await core.getReport(Number(args[0]));
        if (!rep || rep.status !== 'pending') return send('Laporan tidak ditemukan atau sudah ditutup.');
        await core.closeReport(rep.id, 'batal', by);
        await core.log(by, 'batal', rep.id);
        return send(`Laporan #${rep.id} dibatalkan.`);
      }

      case 'mgkick': {
        const id = Number(args[0]);
        if (!id) return send(`Contoh: *${prefix}mgkick 12*`);
        if (!memberGroups(cfg).length) return send('WA_GROUP_JID belum diisi.');
        await send(`⏳ Memproses laporan #${id}…`);
        const r = await executeKick(sock, id, args.slice(1), by);
        return send(r.text, r.mentions || []);
      }

      case 'mgbelum':
      case 'mgkickbelum': {
        if (!memberGroups(cfg).length) return send('WA_GROUP_JID belum diisi.');
        const list = await itemsUnregistered(sock);
        if (!list.length) return send('👍 Semua member sudah mendaftarkan akun X.');
        const mentions = list.map((it) => it.pn || it.lid).filter(Boolean);
        if (command === 'mgbelum') {
          return send(`*Member belum mendaftar akun X (${list.length})*\n` + list.map((it, i) => `${i + 1}. ${itemTag(it)}`).join('\n'), mentions);
        }
        const rep = await core.createReport('belumdaftar', list);
        await core.log(by, 'kickbelum', rep.id);
        const f = await core.formatReportWa(rep);
        return send(f.text, f.mentions);
      }

      case 'mgpemilik': {
        const u = util.normUser(args[0]);
        if (!u) return send(`Contoh: *${prefix}mgpemilik namaakun*`);
        const { account, owner, groups } = await core.accountInfo(u);
        if (!account) return send(`@${u} belum didaftarkan siapa pun.${groups.length ? ` (ada di grup DM: ${groups.join(', ')})` : ''}`);
        const all = (await core.ownerAccounts(owner.id)).map((a) => `@${a.username} (${a.state})`).join(', ');
        return send(
          `*@${u}*\nPemilik: ${ownerLabel(owner)} [${owner.status}]\nStatus: ${account.state} (tidak terlihat ${account.miss_count}x)\n` +
          `Grup DM: ${groups.join(', ') || '-'}\nSemua akun pemilik: ${all}`,
          [owner.wa_pn || owner.wa_lid].filter(Boolean),
        );
      }

      case 'mgtambah': {
        const target = (Array.isArray(mentionedJid) && mentionedJid[0]) || null;
        if (!target) return send(`Tag member-nya. Contoh: *${prefix}mgtambah @member akun1 akun2*`);
        const t = String(target).replace(/:\d+(?=@)/, '');
        const tw = { pn: t.endsWith('@s.whatsapp.net') ? t : null, lid: t.endsWith('@lid') ? t : null };
        const p = await findMember(sock, tw);
        if (!p) return send('Orang itu bukan anggota grup member.');
        const { ok } = util.parseUsers(args.filter((a) => !a.startsWith('@')).join(' '));
        if (!ok.length) return send('Tulis akun X-nya setelah tag.');
        const owner = await core.upsertOwner({ pn: tw.pn || pnOf(p), lid: tw.lid || lidOf(p), name: null });
        const r = await core.registerAccounts(owner.id, ok);
        await core.log(by, 'tambah', { owner: owner.id, added: r.added, taken: r.taken.map((x) => x.username) });
        return send([
          r.added.length ? `✅ Ditambahkan: ${r.added.map((u) => '@' + u).join(', ')}` : null,
          r.mine.length ? `ℹ️ Sudah miliknya: ${r.mine.map((u) => '@' + u).join(', ')}` : null,
          r.taken.length ? `⛔ Milik orang lain: ${r.taken.map((x) => `@${x.username} (${ownerLabel(x.owner)})`).join(', ')}` : null,
          r.limit.length ? `⛔ Lewat batas: ${r.limit.join(', ')}` : null,
        ].filter(Boolean).join('\n') || 'Tidak ada perubahan.');
      }

      case 'mglepas': {
        const u = util.normUser(args[0]);
        if (!u) return send(`Contoh: *${prefix}mglepas namaakun*`);
        const ok = await core.removeAccount(u);
        if (ok) await core.log(by, 'lepas', u);
        return send(ok ? `@${u} dilepas dari pemiliknya.` : `@${u} tidak terdaftar.`);
      }
    }
  } catch (e) {
    console.error('[member-guard] admin:', e);
    return send(`_⚠️ Gagal: ${e.message}_`);
  }
}

export default {
  handle,
  Commands: ['mg', 'mgmenu', 'mgidgrup', 'mgstatus', 'mgcek', 'mglaporan', 'mgbatal', 'mgkick', 'mgbelum', 'mgkickbelum', 'mgpemilik', 'mgtambah', 'mglepas'],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 0,
};
