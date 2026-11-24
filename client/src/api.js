async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status; // 401 = signed out; App shows the login screen
    throw err;
  }
  return data;
}

export const api = {
  me: () => request('/auth/me'),
  login: (name, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ name, password }) }),
  logout: () => request('/auth/logout', { method: 'POST', body: '{}' }),
  meta: () => request('/meta'),
  // `agent` is only used in demo mode (login off), where the dashboard says who is acting.
  stats: (agent) => request(`/stats?${new URLSearchParams(agent ? { agent } : {})}`),
  list: ({ filter, q, intent, agent }) => {
    const params = new URLSearchParams({ filter });
    if (q) params.set('q', q);
    if (intent) params.set('intent', intent);
    if (agent) params.set('agent', agent);
    return request(`/conversations?${params}`);
  },
  get: (id, agent) => request(`/conversations/${id}?${new URLSearchParams(agent ? { agent } : {})}`),
  addNote: (id, body, agent) => request(`/conversations/${id}/notes`, { method: 'POST', body: JSON.stringify({ body, agent }) }),
  deleteNote: (noteId, agent) => request(`/notes/${noteId}`, { method: 'DELETE', body: JSON.stringify({ agent }) }),
  setReminder: (id, remindAt, agent) =>
    request(`/conversations/${id}/reminder`, { method: 'PUT', body: JSON.stringify({ remindAt, agent }) }),
  bulk: (ids, action, agent, assignee) =>
    request('/conversations/bulk', { method: 'POST', body: JSON.stringify({ ids, action, agent, assignee }) }),
  read: (id, agent) => request(`/conversations/${id}/read`, { method: 'POST', body: JSON.stringify({ agent }) }),
  reply: (id, text, agent, savedReplyId) =>
    request(`/conversations/${id}/reply`, { method: 'POST', body: JSON.stringify({ text, agent, savedReplyId }) }),
  savedReplies: () => request('/saved-replies'),
  createSavedReply: (r) => request('/saved-replies', { method: 'POST', body: JSON.stringify(r) }),
  updateSavedReply: (id, r) => request(`/saved-replies/${id}`, { method: 'PUT', body: JSON.stringify(r) }),
  deleteSavedReply: (id) => request(`/saved-replies/${id}`, { method: 'DELETE', body: '{}' }),
  setStatus: (id, status, agent) =>
    request(`/conversations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, agent }) }),
  correctIntent: (messageId, intent, agent) =>
    request(`/messages/${messageId}/intent`, { method: 'PATCH', body: JSON.stringify({ intent, agent }) }),
  assign: (id, assignee) =>
    request(`/conversations/${id}/assignee`, { method: 'PATCH', body: JSON.stringify({ assignee }) }),
};
