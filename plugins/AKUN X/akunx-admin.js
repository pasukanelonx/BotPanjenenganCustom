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
  `${p}mgnomor 08xx / @tag — akun X milik nomor itu`,
  `${p}mgtambah @member akun1 akun2 — daftarkan atas nama member`,
  `${p}mglepas akun — lepas akun dari pemiliknya`,
  `${p}mgidgrup — JID grup ini`,
  '',
  '*Grup XChat*',
  `${p}mgxkick — calon kick dari grup XChat (blacklist / bukan member WA)`,
  `${p}mgxkick ID [-no …] — jalankan kick XChat`,
  `${p}mgrekap [YYYY-MM-DD] — rekap link postingan ke spreadsheet`,
  '',
  '*Blacklist*',
  `${p}mgbl — daftar blacklist`,
  `${p}mgblx akun1 akun2 — blacklist akun X`,
  `${p}mgblwa 08xx / @tag — blacklist nomor WA`,
  `${p}mgunbl akun / 08xx / @tag — hapus dari blacklist`,
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
        const kr = await core.getReport(id);
        if (kr?.kind === 'xkick') return send(`Laporan #${id} adalah kick *grup XChat*. Pakai: *${prefix}mgxkick ${id}*`);
        if (!memberGroups(cfg).length) return send('WA_GROUP_JID belum diisi.');
        await send(`⏳ Memproses laporan #${id}…`);
        const r = await executeKick(sock, id, args.slice(1), by);
        return send(r.text, r.mentions || []);
      }

      case 'mgxkick': {
        const id = Number(args[0]);
        if (!id) {
          const { report, skippedFamilies } = await core.xKickReport();
          const warn = (skippedFamilies || []).map((f) => `⚠️ ${f.family} dilewati: ${f.why}`).join('\n');
          if (!report) return send(`✅ Tidak ada akun yang perlu dikeluarkan dari grup XChat.${warn ? '\n\n' + warn : ''}`);
          const f = await core.formatReportWa(report);
          return send(
            `${f.text}\n\nKick semua: *${prefix}mgxkick ${report.id}*\nKecualikan nomor urut: *${prefix}mgxkick ${report.id} -2 -5*\nBatalkan: *${prefix}mgbatal ${report.id}*` +
              `\n\nMaks ${cfg.xKickMax || 15} akun per sesi, ±30 detik per akun. Hasil dikirim ke grup admin.` + (warn ? `\n\n${warn}` : '')
          );
        }
        const rep = await core.getReport(id);
        if (!rep || rep.kind !== 'xkick') return send(`Laporan #${id} bukan laporan kick XChat. Ketik *${prefix}mgxkick* untuk membuat daftar baru.`);
        if (rep.status !== 'pending') return send(`Laporan #${id} sudah ${rep.status}.`);
        const exclude = args.slice(1).map((a) => Number(a.replace(/^-/, ''))).filter(Boolean);
        const j = await core.addJob('xkick', { id, exclude, by });
        if (j.duplicate) return send('⏳ Masih ada kick XChat lain di antrean.');
        await core.log(by, 'xkick-antre', { id, exclude });
        return send(`🦶 Kick XChat laporan #${id} masuk antrean${exclude.length ? ` (kecuali no. ${exclude.join(', ')})` : ''}. Hasilnya dikirim ke grup admin.`);
      }

      case 'mgrekap': {
        const d = args[0] || null;
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return send(`Contoh: *${prefix}mgrekap* (hari ini) atau *${prefix}mgrekap 2026-10-07*`);
        const j = await core.addJob('rekap', { ymd: d, by });
        return send(j.duplicate ? 'Rekap link sudah dalam antrean.' : `📑 Rekap link${d ? ' ' + d : ' hari ini'} masuk antrean. Hasilnya dikirim ke Telegram.`);
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

      case 'mgnomor': {
        // target: tag, atau nomor 08xx / 628xx / +62 8xx
        let target = (Array.isArray(mentionedJid) && mentionedJid[0]) || null;
        if (!target) {
          let d = (content || '').replace(/\D/g, '');
          if (d.startsWith('0')) d = '62' + d.slice(1);
          if (d.length >= 10) target = `${d}@s.whatsapp.net`;
        }
        if (!target) return send(`Contoh: *${prefix}mgnomor 0812xxxx* atau *${prefix}mgnomor @member*`);
        const t = String(target).replace(/:\d+(?=@)/, '');
        const tw = { pn: t.endsWith('@s.whatsapp.net') ? t : null, lid: t.endsWith('@lid') ? t : null };
        // lengkapi pn/lid dari daftar anggota grup WA
        const inGroups = [];
        for (const { gid, meta } of await memberMetas(sock)) {
          const p = meta?.participants?.find((x) => matchP(x, tw));
          if (!p) continue;
          tw.pn = tw.pn || pnOf(p);
          tw.lid = tw.lid || lidOf(p);
          const fam = (cfg.waGroups || []).find((f) => f.jid === gid);
          inGroups.push(`${meta?.subject || gid}${fam ? ` [${fam.family}]` : ''}${p.admin ? ' (admin)' : ''}`);
        }
        const owner = await core.findOwner(tw);
        const label = tw.pn ? tw.pn.split('@')[0] : '@' + (tw.lid || t).split('@')[0];
        const head = [`*Data ${label}*${owner?.name ? ` (${owner.name})` : ''}`, `Grup WA: ${inGroups.join(', ') || 'tidak ada di grup member'}`];
        const accs = owner ? await core.ownerAccounts(owner.id) : [];
        if (!accs.length) {
          return send([...head, '', '⚠️ Belum mendaftarkan akun X.'].join('\n'), [tw.pn || tw.lid].filter(Boolean));
        }
        const lines = [];
        for (const a of accs) {
          const { groups } = await core.accountInfo(a.username);
          lines.push(groups.length
            ? `• @${a.username} — ✅ ada di ${groups.join(', ')}`
            : `• @${a.username} — ❌ tidak terlihat di grup XChat${a.state === 'baru' ? ' (belum dicek)' : ` (${a.miss_count}x)`}`);
        }
        return send([...head, `Status: ${owner.status}`, '', `*Akun X (${accs.length})*`, ...lines].join('\n'), [tw.pn || tw.lid].filter(Boolean));
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
          r.blocked?.length ? `⛔ Akun blacklist: ${r.blocked.map((u) => '@' + u).join(', ')}` : null,
        ].filter(Boolean).join('\n') || 'Tidak ada perubahan.');
      }

      case 'mgbl': {
        const b = await core.blacklistList();
        return send([
          '*Blacklist*',
          `Akun X (${b.x.length}): ${b.x.map((u) => '@' + u).join(', ') || '-'}`,
          `Nomor WA (${b.wa.length}): ${b.wa.join(', ') || '-'}`,
        ].join('\n'));
      }

      case 'mgblx': {
        const { ok } = util.parseUsers(args.join(' '));
        if (!ok.length) return send(`Contoh: *${prefix}mgblx akun1 akun2*`);
        const r = await core.blacklistAdd('x', ok, by);
        return send([
          `🚫 Diblacklist: ${r.added.map((u) => '@' + u).join(', ')}`,
          ...r.released.map((x) => `↳ @${x.username} dilepas dari ${ownerLabel(x.owner)}`),
          'Akun ini tidak bisa didaftarkan lagi, dan admin diberi tahu kalau terlihat di grup XChat.',
        ].join('\n'));
      }

      case 'mgblwa':
      case 'mgunbl': {
        // target WA: tag atau nomor
        let target = (Array.isArray(mentionedJid) && mentionedJid[0]) || null;
        let d = (content || '').replace(/@\S+/g, '').replace(/\D/g, '');
        if (d.startsWith('0')) d = '62' + d.slice(1);
        if (!target && d.length >= 10) target = `${d}@s.whatsapp.net`;
        if (command === 'mgunbl' && !target) {
          const u = util.normUser(args[0]);
          if (!u) return send(`Contoh: *${prefix}mgunbl akunx* atau *${prefix}mgunbl 0812xxxx*`);
          return send((await core.blacklistRemove(u)) ? `✅ @${u} dihapus dari blacklist.` : `@${u} tidak ada di blacklist.`);
        }
        if (!target) return send(`Contoh: *${prefix}${command} 0812xxxx* atau *${prefix}${command} @member*`);
        const t = String(target).replace(/:\d+(?=@)/, '');
        const tw = { pn: t.endsWith('@s.whatsapp.net') ? t : null, lid: t.endsWith('@lid') ? t : null };
        const p = await findMember(sock, tw);
        if (p) { tw.pn = tw.pn || pnOf(p); tw.lid = tw.lid || lidOf(p); }
        const label = tw.pn ? tw.pn.split('@')[0] : (tw.lid || t).split('@')[0];
        if (command === 'mgunbl') {
          let ok = false;
          for (const v of [tw.pn, tw.lid, label].filter(Boolean)) ok = (await core.blacklistRemove(v)) || ok;
          return send(ok ? `✅ ${label} dihapus dari blacklist.` : `${label} tidak ada di blacklist.`);
        }
        await core.blacklistAdd('wa', [{ ...tw, label }], by);
        await syncWa(sock).catch(() => {});
        const rep = await core.blacklistReport();
        if (!rep) return send(`⛔ ${label} diblacklist. Nomor ini tidak bisa mendaftar, dan masuk laporan kick kalau ada di grup member.`);
        const f = await core.formatReportWa(rep);
        return send(`⛔ ${label} diblacklist.\n\n${f.text}`, f.mentions);
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
  Commands: ['mg', 'mgmenu', 'mgidgrup', 'mgstatus', 'mgcek', 'mglaporan', 'mgbatal', 'mgkick', 'mgbelum', 'mgkickbelum', 'mgpemilik', 'mgnomor', 'mgtambah', 'mglepas', 'mgbl', 'mgblx', 'mgblwa', 'mgunbl', 'mgxkick', 'mgrekap'],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 0,
};
