/** Official house server for the musehouse.app site. */
const OFFICIAL_HOUSE_URL = "https://api.musehouse.app";

/**
 * Where the house server lives:
 * - on musehouse.app (and www.) → always the official API,
 * - otherwise VITE_HOUSE_URL if set (other deployments),
 * - otherwise the same origin (local dev, or the server-hosted viewer).
 */
function resolveHouseUrl(): string {
  const host = location.hostname;
  if (host === "musehouse.app" || host.endsWith(".musehouse.app")) return OFFICIAL_HOUSE_URL;
  return (import.meta.env.VITE_HOUSE_URL ?? "").replace(/\/+$/, "") || location.origin;
}

export const HOUSE_URL = resolveHouseUrl();

/** Muse House's X account (without @). Set VITE_X_HANDLE, or change the default here. Empty hides the button. */
export const X_HANDLE = (import.meta.env.VITE_X_HANDLE ?? "").replace(/^@/, "").trim();
export const X_URL = X_HANDLE ? `https://x.com/${X_HANDLE}` : "";
