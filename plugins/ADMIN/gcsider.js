import { sendMessageWithMention } from '../../lib/utils.js';
import mess from '../../strings.js';
import { filterSiderParticipants } from '../../lib/users.js';
import { getGroupMetadata } from '../../lib/cache.js';
import { getTotalChatPerGroup } from '../../lib/totalchat.js';

const TOTAL_HARI_SIDER = 30;

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, sender, senderLid, senderType } = messageInfo;
  if (!isGroup) return;

  try {
    const groupMetadata = await getGroupMetadata(sock, remoteJid);
    const participants = groupMetadata.participants;

    const isAdmin = participants.some(
      (p) => (p.phoneNumber === sender || p.id === sender) && p.admin,
    );

    if (!isAdmin) {
      await sock.sendMessage(remoteJid, { text: mess.general.isAdmin }, { quoted: message });
      return;
    }

    // Sider = member (bukan admin, bukan bot) yang 0 chat sejak total chat grup ini terakhir direset
    // (.resettotalchat). ".gcsider lama" = cara lama: tidak aktif >= TOTAL_HARI_SIDER hari.
    const mode = String(messageInfo.content || messageInfo.text || '').trim().split(/\s+/).pop()?.toLowerCase();
    const oldMode = mode === 'lama';
    const chats = oldMode ? {} : getTotalChatPerGroup(remoteJid);
    const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map((j) => String(j).replace(/:\d+@/, '@'));
    const countOf = (p) => [p.phoneNumber, p.id, p.lid, p.jid].filter(Boolean).reduce((n, j) => n + (chats[j] || 0), 0);
    const isBot = (p) => [p.phoneNumber, p.id, p.lid].filter(Boolean).some((j) => botIds.includes(String(j)));
    const siderMembers = oldMode
      ? filterSiderParticipants(participants, TOTAL_HARI_SIDER)
      : participants.filter((p) => !p.admin && !isBot(p) && countOf(p) === 0);

    if (siderMembers.length === 0) {
      return await sock.sendMessage(
        remoteJid,
        { text: '📋 _Tidak ada member sider di grup ini._' },
        { quoted: message },
      );
    }

    const memberList = siderMembers
      .map((p) => {
        const number = p.phoneNumber?.split('@')[0] || p.id?.split('@')[0]; // fallback aman
        return `◧ @${number}`;
      })
      .join('\n');

    const countSider = siderMembers.length;

    const teks_sider = `_*${countSider} Dari ${participants.length}* Anggota Grup ${groupMetadata.subject} Adalah Sider_
        
_*Dengan Alasan :*_
${oldMode ? `➊ _Tidak Aktif Selama lebih dari ${TOTAL_HARI_SIDER} hari_\n➋ _Join Tapi Tidak Pernah Nimbrung_` : '➊ _Belum pernah chat sejak total chat grup direset_\n➋ _Join Tapi Tidak Pernah Nimbrung_'}

_Harap Aktif Di Grup Karena Akan Ada Pembersihan Member Setiap Saat_

_*List Member Sider*_
${memberList}`;

    await sendMessageWithMention(sock, remoteJid, teks_sider, message, senderType);
  } catch (error) {
    console.error('Error handling listalluser:', error);
    await sock.sendMessage(
      remoteJid,
      { text: '⚠️ Terjadi kesalahan saat menampilkan semua anggota grup.' },
      { quoted: message },
    );
  }
}

export default {
  handle,
  Commands: ['gcsider'],
  OnlyPremium: false,
  OnlyOwner: false,
};
