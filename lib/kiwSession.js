const session = new Map();
const reportMap = new Map();
const TTL = 5 * 60 * 1000;
const REPORT_TTL = 24 * 60 * 60 * 1000;

export function setKiwSession(sender, data) {
  session.set(sender, { ...data, expire: Date.now() + TTL });
}

export function getKiwSession(sender) {
  const s = session.get(sender);
  if (!s) return null;
  if (Date.now() > s.expire) {
    session.delete(sender);
    return null;
  }
  return s;
}

export function clearKiwSession(sender) {
  session.delete(sender);
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