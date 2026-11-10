// Conversation-level rules built on top of per-message intents. Pure functions.

export const INTENTS = [
  'price', 'size', 'availability', 'cod_shipping', 'order_status', 'return_exchange',
  'complaint', 'collab', 'spam', 'greeting', 'follow_up',
];

export const PRIORITY = Object.freeze({ URGENT: 'URGENT', NORMAL: 'NORMAL', LOW: 'LOW' });

// Messages that carry no request of their own.
const NO_CONTENT = new Set(['greeting', 'follow_up', 'unclassified']);

/**
 * What is this conversation about?
 * @param {{intent: string}[]} inboundNewestFirst  all customer messages, newest first
 * @param {{intent: string}[]} unanswered          customer messages since our last reply
 */
export function conversationIntent(inboundNewestFirst, unanswered) {
  // An unanswered complaint stays the topic even if the customer then asks something else.
  if (unanswered.some((m) => m.intent === 'complaint')) return 'complaint';
  const substantive = inboundNewestFirst.find((m) => m.intent && !NO_CONTENT.has(m.intent));
  if (substantive) return substantive.intent;
  return inboundNewestFirst.find((m) => m.intent && m.intent !== 'unclassified')?.intent ?? null;
}

/**
 * Is the customer chasing us? A text model cannot tell "hi" from a nudge; context can:
 * any greeting or follow-up that arrives while an earlier message is still unanswered.
 * @param {{intent: string}[]} unansweredOldestFirst
 */
export function isChasing(unansweredOldestFirst) {
  return unansweredOldestFirst.slice(1).some((m) => m.intent === 'follow_up' || m.intent === 'greeting');
}

export function priorityFor(intent, chasing) {
  if (intent === 'complaint' || chasing) return PRIORITY.URGENT;
  if (intent === 'spam') return PRIORITY.LOW;
  return PRIORITY.NORMAL;
}
