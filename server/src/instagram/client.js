// Thin client for Meta's Instagram messaging API ("Instagram API with Instagram Login").
//
//   send a reply:   POST https://graph.instagram.com/{version}/{ig-user-id}/messages
//                   { recipient: { id: <IGSID> }, message: { text } }   -> { recipient_id, message_id }
//   look up user:   GET  https://graph.instagram.com/{version}/{IGSID}?fields=username,name
//
// Endpoint paths, the API version and permission names change over time: check them against
// Meta's current docs before going live. Host, version and account id are all configurable,
// so a change there needs no code edit.
// The access token is a secret: it is read from the environment and never logged or returned.

export class InstagramApiError extends Error {
  constructor(message, { status, code, subcode, retryable } = {}) {
    super(message);
    this.name = 'InstagramApiError';
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.retryable = Boolean(retryable);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.accessToken  long-lived token with the messaging permission
 * @param {string} [opts.userId]     the business account's Instagram user id ("me" works with Instagram Login)
 * @param {string} [opts.version]    Graph API version, e.g. "v23.0"
 * @param {string} [opts.host]       API host
 * @param {typeof fetch} [opts.fetch] injectable for tests
 * @param {number} [opts.timeoutMs]
 */
export function createInstagramClient({
  accessToken,
  userId = 'me',
  version = 'v23.0',
  host = 'https://graph.instagram.com',
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  const base = `${host.replace(/\/+$/, '')}/${version}`;

  async function call(path, { method = 'GET', body, query } = {}) {
    if (!accessToken) throw new InstagramApiError('IG_ACCESS_TOKEN is not set', { status: 0 });
    const url = new URL(`${base}/${path}`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

    let res;
    try {
      res = await fetchImpl(url, {
        method,
        // Token in a header, not the URL, so it never ends up in proxy or access logs.
        headers: { authorization: `Bearer ${accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : err?.message ?? 'network error';
      throw new InstagramApiError(`Instagram API unreachable: ${reason}`, { retryable: true });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      const e = data?.error ?? {};
      throw new InstagramApiError(e.message || `Instagram API error (HTTP ${res.status})`, {
        status: res.status,
        code: e.code,
        subcode: e.error_subcode,
        // 429 / 5xx are worth retrying later; 4xx (bad token, window closed, blocked user) are not.
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    return data;
  }

  return {
    /** Send a text DM. Returns Meta's message id, which also arrives later as an "echo" webhook. */
    async sendText(recipientId, text) {
      const data = await call(`${encodeURIComponent(userId)}/messages`, {
        method: 'POST',
        body: { recipient: { id: String(recipientId) }, message: { text } },
      });
      if (!data.message_id) throw new InstagramApiError('Instagram API returned no message_id');
      return { mid: data.message_id, recipientId: data.recipient_id ?? String(recipientId) };
    },

    /** Username for a customer's Instagram-scoped id (webhooks only carry the numeric id). */
    async getProfile(igsid) {
      const data = await call(encodeURIComponent(igsid), { query: { fields: 'username,name' } });
      return { username: data.username ?? null, name: data.name ?? null };
    },
  };
}
