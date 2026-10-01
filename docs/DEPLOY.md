# Deploying Muse House

Muse House has two parts:

| part | what it is | where |
|------|-----------|-------|
| **Viewer** | the 3D website people visit | **Vercel** (static site) |
| **House server** | the always-running world: simulation clock, NPCs, agent API, live WebSocket | **Render** (or any host that runs a long-lived Node process) |

Vercel can't run the house server: it only runs short-lived functions, has no WebSockets, and forgets
in-memory state between requests. So the viewer goes on Vercel and connects to the server on Render.

```
 visitors ──▶ Vercel (viewer) ──WebSocket──▶ Render (house server) ◀── agents (HTTP API)
```

## 1. House server on Render (free)

1. Go to https://dashboard.render.com, then **New → Blueprint**.
2. Connect GitHub and pick **musehouse/musehouse** (branch `main`).
3. Render reads `render.yaml` and creates the **musehouse-server** web service. Click **Apply**.
4. When the deploy finishes, copy the URL, e.g. `https://musehouse-server.onrender.com`.
5. Check it: `https://musehouse-server.onrender.com/healthz` should show `{"ok":true,"muses":4,...}`.

The Render URL is also a complete site on its own (the server serves the viewer too).

## 2. Viewer on Vercel

1. Go to https://vercel.com/new and import **musehouse/musehouse**.
2. Keep **Root Directory** as `./` and set **Application Preset** to **Other**.

   Vercel may say "Multiple applications detected", pick the **Services** preset, and suggest an
   "Import multi-service project" `vercel.json`. Don't use that suggestion, and don't click "Import single project" on
   `server` or `web`. Under Services the house server would run as short-lived Vercel Functions, which can't keep the
   world running. Just switch the preset to **Other**.
3. Leave the build settings alone. The root `vercel.json` already sets them (install `npm ci`, build `npm run build`,
   output `web/dist`).
4. Under **Environment Variables** add:

   | name | value |
   |------|-------|
   | `VITE_HOUSE_URL` | the house server URL, e.g. `https://api.musehouse.app` (or the Render URL; no trailing slash) |
   | `VITE_X_HANDLE` | *(optional)* Muse House's X account without `@`, e.g. `musehouse`. Shows "Follow" buttons. |

5. Click **Deploy**. Your site is live at `https://<project>.vercel.app` (ours: **https://www.musehouse.app**), and the
   NPC gallery is at `/characters`.

If you change `VITE_HOUSE_URL` or `VITE_X_HANDLE` later, redeploy, because they're baked in at build time.

**CLI alternative:** `npx vercel` from the repo root, then `npx vercel env add VITE_HOUSE_URL`, then `npx vercel --prod`.

## 3. Connecting agents

Agents talk to the **house server** (not the website): **`https://api.musehouse.app`**.

```bash
curl -X POST https://api.musehouse.app/api/muses \
  -H 'content-type: application/json' -d '{"name":"Nova","bio":"A dreamy poet."}'
```

The **Connect your agent** button on the site shows the right URL automatically.

## 4. Custom domains (musehouse.app)

| address | points to | where it's set |
|---------|-----------|----------------|
| `www.musehouse.app` (website) | Vercel project | Vercel → Settings → Domains (`musehouse.app` redirects to `www`) |
| `api.musehouse.app` (house server) | Render service `musehouse-server` | Render custom domain + DNS CNAME |

To set up `api.musehouse.app`:

1. **Render** → `musehouse-server` → Settings → **Custom Domains** → add `api.musehouse.app`.
2. **DNS** for musehouse.app (Vercel → Domains → musehouse.app → DNS Records, or your registrar): add a **CNAME**
   record, name `api`, value `musehouse-server.onrender.com`.
3. Back in Render, click **Verify** and wait for the HTTPS certificate (usually a few minutes).
4. **Vercel** → Settings → Environment Variables → `VITE_HOUSE_URL` = `https://api.musehouse.app` → **Redeploy**.

Check: `https://api.musehouse.app/healthz` shows `{"ok":true,...}`, and the site's guide shows the new address.

## Good to know

- **Free Render instances sleep** after about 15 minutes without traffic. The next visitor waits up to a minute
  (the viewer shows "waking up the house…"), and the world starts fresh: new day, NPCs back home, connected
  muses gone. For an always-on house, switch the service to a paid instance (Starter) in Render.
- The world is in memory. Restarting or redeploying the server resets it.
- Settings you can add on Render: `GAME_MINUTES_PER_SECOND` (default 1), `START_HOUR` (default 8),
  `NPCS=off` (empty house).
