# OpenAPI Tester

A zero-dependency, single-file API testing platform. Upload any `openapi.json` and instantly get a fully configured test UI — sliders, toggles, dropdowns, file uploads, auth headers — with no CORS issues.

![No dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen?style=flat)
![Node version](https://img.shields.io/badge/node-%3E%3D14-blue?style=flat&logo=node.js)
![Deploy to Netlify](https://img.shields.io/badge/deploy-Netlify-00C7B7?style=flat&logo=netlify)

---

## Features

- **Upload any `openapi.json`** — drop a file, paste JSON, or try the built-in example
- **Smart field types** auto-inferred from the schema:
  - `boolean` → toggle switch
  - `number/integer` with min/max bounds → slider
  - `enum` → dropdown
  - `string format: binary` → file picker
  - `array items format: binary` → multi-file picker
  - Long-text fields (`description`, `context`, `notes`...) → textarea
  - `secret` / `password` fields → password input
  - Everything else → text input
- **All parameter locations handled** — path, query, request body, headers
- **Auth** — Bearer token, API Key (`X-Api-Key`), Basic, or any custom header name
- **No CORS issues** — proxied server-side on Netlify, or via local `proxy.js`
- **Run All** — fires every endpoint sequentially with a live progress bar
- **Dark mode** — follows system preference automatically

---

## Deploy to Netlify

### Option A — Drag & Drop (no Git needed)

1. Download or clone this repo
2. Go to [netlify.com](https://netlify.com) → log in
3. Click **Add new site** → **Deploy manually**
4. Drag the project folder onto the deploy box
5. Live at `https://your-site.netlify.app` in ~10 seconds

### Option B — Deploy from GitHub

1. Fork this repo
2. Go to [netlify.com](https://netlify.com) → **Add new site** → **Import from Git**
3. Connect GitHub → select your fork
4. Leave build settings blank (no build command, no publish directory needed)
5. Click **Deploy** — auto-deploys on every push to main

### How the CORS proxy works on Netlify

`netlify.toml` contains one redirect rule:

```toml
[[redirects]]
  from   = "/proxy/*"
  to     = ":splat"
  status = 200
  force  = true
```

When the tester calls `/proxy/https://api.example.com/users`, Netlify's edge rewrites it to `https://api.example.com/users` server-side. Your API never sees a browser `Origin` header, so CORS is bypassed completely.

---

## Run locally

### Direct file (no server)

Open `index.html` directly in your browser. Most things work. If an endpoint returns a CORS error, use the proxy below.

### With proxy (fixes CORS, mirrors Netlify exactly)

Requires Node.js ≥ 14. No `npm install` needed — zero dependencies.

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/openapi-tester.git
cd openapi-tester

# Start
node proxy.js

# Open
open http://localhost:3131
```

Custom port:

```bash
node proxy.js --port=8080
```

---

## Usage

1. **Load your spec** — drag & drop `openapi.json`, paste JSON, or click "Try example spec"
2. **Set Base URL** — auto-filled from `servers[0].url` in the spec, editable
3. **Set API Key** — paste your token, choose auth type
4. **Select an endpoint** from the left sidebar
5. **Configure parameters:**
   - Drag sliders for numeric ranges (`alpha`, `temperature`, `limit`...)
   - Flip toggles for booleans (`infer`, `upsert`, `include_metadata`...)
   - Pick from dropdowns for enums (`mode`, `operator`, `llm_provider`...)
   - Attach files for upload endpoints
6. Click **Run** for one endpoint, or **Run All** to test everything at once

---

## Project structure

```
openapi-tester/
├── index.html      # Entire app — self-contained, no build step
├── proxy.js        # Local dev proxy (Node.js, zero deps)
├── netlify.toml    # Netlify rewrite rule for CORS proxy
├── .gitignore
└── README.md
```

---

## Deploy on other platforms

| Platform | What to add |
|---|---|
| **Vercel** | `vercel.json` with rewrites rule |
| **Cloudflare Pages** | `_redirects` file |
| **Any VPS** | Run `node proxy.js` behind nginx/caddy |

### Vercel (`vercel.json`)

```json
{
  "rewrites": [
    { "source": "/proxy/:url*", "destination": "/:url*" }
  ]
}
```

### Cloudflare Pages (`_redirects`)

```
/proxy/*  :splat  200
```

---

## Security

This tool is meant for personal/team use. If you deploy it publicly, anyone who knows the URL can proxy requests through it. To restrict access:

- **Netlify** → Site settings → Access control → Password protection
- **Netlify Identity** → Restrict to invited users only

---

## License

MIT
