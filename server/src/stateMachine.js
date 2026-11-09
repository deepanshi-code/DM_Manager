// Conversation lifecycle rules. Pure functions only (no database), so they are
// easy to unit-test and to explain in the capstone report.
//
//   NEW ──(agent opens)──▶ OPEN ──(agent replies)──▶ WAITING_ON_CUSTOMER
//    │                      ▲  │                          │
//    │                      │  └──────(resolve)───────▶ RESOLVED
//    └─(reply)─▶ WAITING    └──(customer writes again)───┘
//
// "Overdue" is deliberately NOT a status. A NEW or OPEN chat can both be overdue;
// overdue is a *timer* on top of the lifecycle (see isOverdue / scheduler.js).

export const STATUS = Object.freeze({
  NEW: 'NEW',
  OPEN: 'OPEN',
  WAITING: 'WAITING_ON_CUSTOMER',
  RESOLVED: 'RESOLVED',
});

export const ALL_STATUSES = Object.values(STATUS);

// Transitions an agent may trigger by hand from the dashboard.
const MANUAL_TRANSITIONS = {
  NEW: [STATUS.OPEN, STATUS.RESOLVED],
  OPEN: [STATUS.WAITING, STATUS.RESOLVED],
  WAITING_ON_CUSTOMER: [STATUS.OPEN, STATUS.RESOLVED],
  RESOLVED: [STATUS.OPEN],
};

export function allowedTransitions(from) {
  return MANUAL_TRANSITIONS[from] ?? [];
}

export function canTransition(from, to) {
  return allowedTransitions(from).includes(to);
}

/** Status after a customer message arrives. A message never leaves a chat "resolved". */
export function statusAfterInbound(current) {
  if (!current || current === STATUS.NEW) return STATUS.NEW;
  return STATUS.OPEN;
}

/** Status after an agent reply is successfully delivered. */
export function statusAfterReply() {
  return STATUS.WAITING;
}

export function isOverdue(needsReplySince, now, slaSeconds) {
  if (!needsReplySince) return false;
  return (new Date(now) - new Date(needsReplySince)) / 1000 >= slaSeconds;
}

/** Whether the business may still send a normal reply (Meta's messaging window). */
export function replyWindow(lastCustomerMessageAt, now, windowHours) {
  if (!lastCustomerMessageAt) return { open: false, closesAt: null, msLeft: 0 };
  const closesAt = new Date(new Date(lastCustomerMessageAt).getTime() + windowHours * 3600_000);
  const msLeft = closesAt - new Date(now);
  return { open: msLeft > 0, closesAt, msLeft: Math.max(0, msLeft) };
}
