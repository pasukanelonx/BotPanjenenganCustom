const session = new Map();
const reportMap = new Map();
const TTL = 10 * 60 * 1000;
const REPORT_TTL = 24 * 60 * 60 * 1000;

function allKeys(messageInfoOrSender) {
  if (!messageInfoOrSender) return [];
  if (typeof messageInfoOrSender === 'string') {
    return [messageInfoOrSender];
  }
  const { sender, senderLid, remoteJid } = messageInfoOrSender;
  return [...new Set([sender, senderLid, remoteJid].filter(Boolean))];
}

export function setKiwSession(messageInfoOrSender, data) {
  const ttl = data?.mode === 'chat_admin' ? 24 * 60 * 60 * 1000 : TTL;
  const payload = { ...data, expire: Date.now() + ttl };
  for (const key of allKeys(messageInfoOrSender)) {
    session.set(key, payload);
  }
}

export function getKiwSession(messageInfoOrSender) {
  for (const key of allKeys(messageInfoOrSender)) {
    const s = session.get(key);
    if (!s) continue;
    if (Date.now() > s.expire) {
      session.delete(key);
      continue;
    }
    return s;
  }
  return null;
}

export function clearKiwSession(messageInfoOrSender) {
  for (const key of allKeys(messageInfoOrSender)) {
    session.delete(key);
  }
}

export function saveReportRef(adminMsgId, data) {
  reportMap.set(adminMsgId, {
    ...data,
    expire: Date.now() + REPORT_TTL,
  });
}

export function getReportRef(adminMsgId) {
  const r = reportMap.get(adminMsgId);
  if (!r) return null;
  if (Date.now() > r.expire) {
    reportMap.delete(adminMsgId);
    return null;
  }
  return r;
}

/** Hapus semua ref laporan/chat untuk user ini (supaya admin reply tidak diteruskan) */
export function clearReportRefsByUser(userJid) {
  if (!userJid) return;
  for (const [id, data] of reportMap.entries()) {
    if (data?.userJid === userJid) {
      reportMap.delete(id);
    }
  }
}