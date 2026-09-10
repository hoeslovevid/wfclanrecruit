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
  putPrefs: (prefs) => request("/api/prefs", { method: "PUT", body: JSON.stringify(prefs) }),
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
  pauseClan: (id, paused, reason) =>
    request(`/api/clans/${id}/pause`, { method: "POST", body: JSON.stringify({ paused, reason: reason || "" }) }),
  hideClan: (id, hidden) =>
    request(`/api/clans/${id}/hide`, { method: "POST", body: JSON.stringify({ hidden }) }),
  reportClan: (id, body) => request(`/api/clans/${id}/report`, { method: "POST", body: JSON.stringify(body) }),
  deleteClan: (id) => request(`/api/clans/${id}`, { method: "DELETE" }),
  countWhisper: (id) => request(`/api/clans/${id}/whisper`, { method: "POST", body: "{}" }),
  roster: (id) => request(`/api/clans/${id}/recruiters`),
  searchRecruiters: (id, q) =>
    request(`/api/clans/${id}/recruiters/search?q=${encodeURIComponent(q)}`),
  inviteRecruiter: (id, username, role, label) =>
    request(`/api/clans/${id}/recruiters`, {
      method: "POST",
      body: JSON.stringify({ username, role, label }),
    }),
  setRecruiterRole: (id, userId, body) =>
    request(`/api/clans/${id}/recruiters/${encodeURIComponent(userId)}/role`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  removeRecruiter: (id, userId) =>
    request(`/api/clans/${id}/recruiters/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  respondToInvite: (id, accept) =>
    request(`/api/clans/${id}/recruiters/respond`, { method: "POST", body: JSON.stringify({ accept }) }),
  offerTransfer: (id, username, kind = "clan") =>
    request(`/api/${kind === "alliance" ? "alliances" : "clans"}/${id}/transfer`, {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
  cancelTransfer: (id, kind = "clan") =>
    request(`/api/${kind === "alliance" ? "alliances" : "clans"}/${id}/transfer`, { method: "DELETE" }),
  listingTransfer: (id, kind = "clan") =>
    request(`/api/${kind === "alliance" ? "alliances" : "clans"}/${id}/transfer`),
  respondToTransfer: (id, accept, kind = "clan") =>
    request(`/api/${kind === "alliance" ? "alliances" : "clans"}/${id}/transfer/respond`, {
      method: "POST",
      body: JSON.stringify({ accept }),
    }),
  removeAllianceRecruiter: (id, userId) =>
    request(`/api/alliances/${id}/recruiters/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  alliances: () => request("/api/alliances"),
  alliance: (id) => request(`/api/alliances/${id}`),
  createAlliance: (formData) => request("/api/alliances", { method: "POST", body: formData }),
  updateAlliance: (id, formData) => request(`/api/alliances/${id}`, { method: "PUT", body: formData }),
  bumpAlliance: (id) => request(`/api/alliances/${id}/bump`, { method: "POST", body: "{}" }),
  pauseAlliance: (id, paused, reason) =>
    request(`/api/alliances/${id}/pause`, { method: "POST", body: JSON.stringify({ paused, reason: reason || "" }) }),
  hideAlliance: (id, hidden) =>
    request(`/api/alliances/${id}/hide`, { method: "POST", body: JSON.stringify({ hidden }) }),
  reportAlliance: (id, body) =>
    request(`/api/alliances/${id}/report`, { method: "POST", body: JSON.stringify(body) }),
  deleteAlliance: (id) => request(`/api/alliances/${id}`, { method: "DELETE" }),
  players: () => request("/api/players"),
  player: (id) => request(`/api/players/${id}`),
  createPlayer: (formData) => request("/api/players", { method: "POST", body: formData }),
  updatePlayer: (id, formData) => request(`/api/players/${id}`, { method: "PUT", body: formData }),
  bumpPlayer: (id) => request(`/api/players/${id}/bump`, { method: "POST", body: "{}" }),
  pausePlayer: (id, paused, reason) =>
    request(`/api/players/${id}/pause`, { method: "POST", body: JSON.stringify({ paused, reason: reason || "" }) }),
  hidePlayer: (id, hidden) =>
    request(`/api/players/${id}/hide`, { method: "POST", body: JSON.stringify({ hidden }) }),
  reportPlayer: (id, body) => request(`/api/players/${id}/report`, { method: "POST", body: JSON.stringify(body) }),
  deletePlayer: (id) => request(`/api/players/${id}`, { method: "DELETE" }),
  countPlayerWhisper: (id) => request(`/api/players/${id}/whisper`, { method: "POST", body: "{}" }),
  inbox: () => request("/api/messages"),
  unread: () => request("/api/messages/unread"),
  openThread: (kind, listingId) =>
    request("/api/messages/open", { method: "POST", body: JSON.stringify({ kind, listingId }) }),
  thread: (id) => request(`/api/messages/${encodeURIComponent(id)}`),
  deleteThread: (id) => request(`/api/messages/${encodeURIComponent(id)}`, { method: "DELETE" }),
  send: (id, body) =>
    request(`/api/messages/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ body }) }),
  readThread: (id) =>
    request(`/api/messages/${encodeURIComponent(id)}/read`, { method: "POST", body: "{}" }),
  markAllRead: () => request("/api/messages/read-all", { method: "POST", body: "{}" }),
  muteThread: (id, muted) =>
    request(`/api/messages/${encodeURIComponent(id)}/mute`, {
      method: "POST",
      body: JSON.stringify({ muted }),
    }),
  reportThread: (id, body) =>
    request(`/api/messages/${encodeURIComponent(id)}/report`, { method: "POST", body: JSON.stringify(body) }),
  blockUser: (userId, blocked) =>
    request("/api/messages/block", { method: "POST", body: JSON.stringify({ userId, blocked }) }),
  blockedList: () => request("/api/messages/blocked"),
  reports: () => request("/api/reports"),
  resolveReport: (id, status) =>
    request(`/api/reports/${id}/resolve`, { method: "POST", body: JSON.stringify({ status }) }),
  staff: () => request("/api/admin/staff"),
  searchStaff: (q) => request(`/api/admin/staff/search?q=${encodeURIComponent(q)}`),
  grantAdmin: (body) =>
    request("/api/admin/staff", {
      method: "POST",
      body: JSON.stringify(typeof body === "string" ? { query: body } : body),
    }),
  revokeAdmin: (id) => request(`/api/admin/staff/${encodeURIComponent(id)}`, { method: "DELETE" }),
  articles: (query = {}) => {
    const params = new URLSearchParams();
    if (query.hub) params.set("hub", query.hub);
    if (query.mine) params.set("mine", "1");
    const qs = params.toString();
    return request(`/api/articles${qs ? `?${qs}` : ""}`);
  },
  article: (id) => request(`/api/articles/${encodeURIComponent(id)}`),
  createArticle: (formData) => request("/api/articles", { method: "POST", body: formData }),
  updateArticle: (id, formData) => request(`/api/articles/${encodeURIComponent(id)}`, { method: "PUT", body: formData }),
  hideArticle: (id, hidden) =>
    request(`/api/articles/${encodeURIComponent(id)}/hide`, { method: "POST", body: JSON.stringify({ hidden }) }),
  reportArticle: (id, body) =>
    request(`/api/articles/${encodeURIComponent(id)}/report`, { method: "POST", body: JSON.stringify(body) }),
  deleteArticle: (id) => request(`/api/articles/${encodeURIComponent(id)}`, { method: "DELETE" }),
  creators: () => request("/api/admin/creators"),
  searchCreators: (q) => request(`/api/admin/creators/search?q=${encodeURIComponent(q)}`),
  grantCreator: (body) =>
    request("/api/admin/creators", {
      method: "POST",
      body: JSON.stringify(typeof body === "string" ? { query: body } : body),
    }),
  revokeCreator: (id) => request(`/api/admin/creators/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
