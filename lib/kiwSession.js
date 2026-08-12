const session = new Map();
const reportMap = new Map();
const TTL = 10 * 60 * 1000; // 10 menit
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
  const payload = { ...data, expire: Date.now() + TTL };
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