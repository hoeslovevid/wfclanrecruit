async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    ...options,
    headers: options.body instanceof FormData
      ? options.headers
      : { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export const api = {
  me: () => request("/api/auth/me"),
  login: (username, password) =>
    request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (username, password) =>
    request("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request("/api/auth/logout", { method: "POST", body: "{}" }),
  exportAccount: () => request("/api/auth/export"),
  deleteAccount: () => request("/api/auth/account", { method: "DELETE" }),
  forumStart: (profileUrl) =>
    request("/api/auth/forum/start", { method: "POST", body: JSON.stringify({ profileUrl }) }),
  forumCheck: (profileUrl) =>
    request("/api/auth/forum/check", { method: "POST", body: JSON.stringify({ profileUrl }) }),
  presenceBeat: () => request("/api/presence/heartbeat", { method: "POST", body: "{}" }),
  setPresence: (status, keepMinutes) =>
    request("/api/presence", { method: "POST", body: JSON.stringify({ status, keepMinutes }) }),
  clans: () => request("/api/clans"),
  clan: (id) => request(`/api/clans/${id}`),
  createClan: (formData) => request("/api/clans", { method: "POST", body: formData }),
  updateClan: (id, formData) => request(`/api/clans/${id}`, { method: "PUT", body: formData }),
  bumpClan: (id) => request(`/api/clans/${id}/bump`, { method: "POST", body: "{}" }),
  pauseClan: (id, paused) =>
    request(`/api/clans/${id}/pause`, { method: "POST", body: JSON.stringify({ paused }) }),
  reportClan: (id, body) => request(`/api/clans/${id}/report`, { method: "POST", body: JSON.stringify(body) }),
  deleteClan: (id) => request(`/api/clans/${id}`, { method: "DELETE" }),
  countWhisper: (id) => request(`/api/clans/${id}/whisper`, { method: "POST", body: "{}" }),
  roster: (id) => request(`/api/clans/${id}/recruiters`),
  inviteRecruiter: (id, username) =>
    request(`/api/clans/${id}/recruiters`, { method: "POST", body: JSON.stringify({ username }) }),
  removeRecruiter: (id, userId) =>
    request(`/api/clans/${id}/recruiters/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  respondToInvite: (id, accept) =>
    request(`/api/clans/${id}/recruiters/respond`, { method: "POST", body: JSON.stringify({ accept }) }),
  alliances: () => request("/api/alliances"),
  alliance: (id) => request(`/api/alliances/${id}`),
  createAlliance: (formData) => request("/api/alliances", { method: "POST", body: formData }),
  updateAlliance: (id, formData) => request(`/api/alliances/${id}`, { method: "PUT", body: formData }),
  bumpAlliance: (id) => request(`/api/alliances/${id}/bump`, { method: "POST", body: "{}" }),
  pauseAlliance: (id, paused) =>
    request(`/api/alliances/${id}/pause`, { method: "POST", body: JSON.stringify({ paused }) }),
  reportAlliance: (id, body) =>
    request(`/api/alliances/${id}/report`, { method: "POST", body: JSON.stringify(body) }),
  deleteAlliance: (id) => request(`/api/alliances/${id}`, { method: "DELETE" }),
  reports: () => request("/api/reports"),
  resolveReport: (id, status) =>
    request(`/api/reports/${id}/resolve`, { method: "POST", body: JSON.stringify({ status }) }),
};
