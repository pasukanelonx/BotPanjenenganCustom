const session = new Map();
const reportMap = new Map();
const TTL = 10 * 60 * 1000;
const REPORT_TTL = 24 * 60 * 60 * 1000;
const CHAT_ADMIN_TTL = 24 * 60 * 60 * 1000;

function allKeys(messageInfoOrSender) {
  if (!messageInfoOrSender) return [];
  if (typeof messageInfoOrSender === 'string') {
    return [messageInfoOrSender];
  }
  const { sender, senderLid, remoteJid } = messageInfoOrSender;
  return [...new Set([sender, senderLid, remoteJid].filter(Boolean))];
}

function peekSession(messageInfoOrSender) {
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

export function setKiwSession(messageInfoOrSender, data) {
  const incoming = data || {};
  const existing = peekSession(messageInfoOrSender);

  const defaultTtl =
    incoming.mode === 'chat_admin' ? CHAT_ADMIN_TTL : TTL;

  // ttl custom (mis. 10 menit setelah join) ikut tersimpan
  // refresh pesan berikutnya memakai sessionTtl yang sama
  const ttl = incoming.ttl || existing?.sessionTtl || defaultTtl;

  const payload = {
    ...incoming,
    sessionTtl: ttl,
    expire: Date.now() + ttl,
  };

  for (const key of allKeys(messageInfoOrSender)) {
    session.set(key, payload);
  }
}

export function getKiwSession(messageInfoOrSender) {
  return peekSession(messageInfoOrSender);
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