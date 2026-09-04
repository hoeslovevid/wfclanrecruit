const INVITE =
  /^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\/([a-zA-Z0-9-]+)/i;

export function inviteCodeFrom(url) {
  const match = String(url || "").trim().match(INVITE);
  return match ? match[3] : null;
}

export function canonicalInvite(code) {
  return `https://discord.gg/${code}`;
}

export async function inspectDiscordInvite(url, { required = true } = {}) {
  const code = inviteCodeFrom(url);
  if (!code) {
    return { ok: false, error: "Use a discord.gg or discord.com/invite link." };
  }
  try {
    const res = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) {
      return { ok: false, error: "That Discord invite is invalid or has expired." };
    }
    if (!res.ok) {
      if (!required) {
        return { ok: true, skipped: true, code, url: canonicalInvite(code), checkedAt: new Date().toISOString() };
      }
      return { ok: false, error: "Could not check that Discord invite. Try again in a moment." };
    }
    const data = await res.json();
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      return { ok: false, error: "That Discord invite has expired. Create a new one that does not expire." };
    }
    return {
      ok: true,
      code,
      url: canonicalInvite(code),
      checkedAt: new Date().toISOString(),
    };
  } catch {
    if (!required) {
      return { ok: true, skipped: true, code, url: canonicalInvite(code), checkedAt: new Date().toISOString() };
    }
    return { ok: false, error: "Could not check that Discord invite. Try again in a moment." };
  }
}

export const INVITE_RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;
export const INVITE_RECHECK_BATCH = 15;
export const INVITE_RECHECK_GAP_MS = 400;

export function listingsNeedingInviteCheck(db, now = Date.now()) {
  return [...(db.clans || []), ...(db.alliances || [])]
    .filter((item) => {
      if (!item.discord) return false;
      const at = new Date(item.inviteCheckedAt || 0).getTime();
      return !Number.isFinite(at) || now - at >= INVITE_RECHECK_AFTER_MS;
    })
    .sort((a, b) => new Date(a.inviteCheckedAt || 0) - new Date(b.inviteCheckedAt || 0))
    .slice(0, INVITE_RECHECK_BATCH);
}

export function applyInviteCheck(item, result) {
  if (!result.ok) {
    item.inviteOk = false;
    item.inviteCheckedAt = new Date().toISOString();
    return "dead";
  }
  if (result.skipped) return "skipped";
  item.discord = result.url;
  item.inviteOk = true;
  item.inviteCheckedAt = result.checkedAt;
  return "ok";
}
