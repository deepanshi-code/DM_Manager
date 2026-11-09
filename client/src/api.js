async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  meta: () => request('/meta'),
  stats: () => request('/stats'),
  list: ({ filter, q }) => {
    const params = new URLSearchParams({ filter });
    if (q) params.set('q', q);
    return request(`/conversations?${params}`);
  },
  get: (id) => request(`/conversations/${id}`),
  read: (id, agent) => request(`/conversations/${id}/read`, { method: 'POST', body: JSON.stringify({ agent }) }),
  reply: (id, text, agent) =>
    request(`/conversations/${id}/reply`, { method: 'POST', body: JSON.stringify({ text, agent }) }),
  setStatus: (id, status, agent) =>
    request(`/conversations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, agent }) }),
  assign: (id, assignee) =>
    request(`/conversations/${id}/assignee`, { method: 'PATCH', body: JSON.stringify({ assignee }) }),
};
