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
  clans: () => request("/api/clans"),
  clan: (id) => request(`/api/clans/${id}`),
  createClan: (formData) => request("/api/clans", { method: "POST", body: formData }),
  updateClan: (id, formData) => request(`/api/clans/${id}`, { method: "PUT", body: formData }),
  bumpClan: (id) => request(`/api/clans/${id}/bump`, { method: "POST", body: "{}" }),
  deleteClan: (id) => request(`/api/clans/${id}`, { method: "DELETE" }),
  alliances: () => request("/api/alliances"),
  alliance: (id) => request(`/api/alliances/${id}`),
  createAlliance: (formData) => request("/api/alliances", { method: "POST", body: formData }),
  updateAlliance: (id, formData) => request(`/api/alliances/${id}`, { method: "PUT", body: formData }),
  bumpAlliance: (id) => request(`/api/alliances/${id}/bump`, { method: "POST", body: "{}" }),
  deleteAlliance: (id) => request(`/api/alliances/${id}`, { method: "DELETE" }),
};
