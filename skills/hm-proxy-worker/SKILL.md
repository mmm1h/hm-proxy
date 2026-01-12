---
name: hm-proxy-worker
description: Maintain and deploy the hm-proxy Cloudflare Worker repo. Use for syncing upstream gh-proxy sources into `upstream/index.js`, updating the optimized Worker implementation in `src/index.js`, adjusting proxy settings (PREFIX, WHITE_LIST, USE_JSDELIVR), editing the sync GitHub Action, or deploying with Wrangler/custom domains.
---

# Hm Proxy Worker

## Overview

Maintain a Cloudflare Worker proxy derived from gh-proxy without the static site fallback. Keep upstream changes tracked, update the optimized worker logic, and deploy safely with Wrangler.

## Workflow

### 1. Sync upstream

Check `upstream/index.js` after the scheduled GitHub Action runs or fetch it manually. Keep this file as a pristine mirror of the upstream source.

### 2. Update the Worker implementation

Compare `src/index.js` against upstream and bring over functional changes as needed. Preserve project-specific behavior:
- Return 404 for non-GitHub targets (no static site).
- Keep `USE_JSDELIVR` disabled unless explicitly requested.
- Keep `PREFIX` starting with `/` and let `PREFIX_PATH` normalize the trailing slash.
- Maintain CORS headers and redirect handling.

### 3. Adjust proxy settings

Edit `src/index.js` configuration constants for the desired behavior:
- `PREFIX` controls the route prefix when using a custom Worker route.
- `WHITE_LIST` blocks requests unless a token match is found.
- `USE_JSDELIVR` toggles jsDelivr redirects for blob/raw targets.

### 4. Deploy

Update `wrangler.toml` (name, account ID, compatibility date) and run `wrangler deploy`. Bind custom domains in the Cloudflare dashboard or via routes if needed.
