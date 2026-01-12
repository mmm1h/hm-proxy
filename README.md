# hm-proxy

Cloudflare Workers proxy based on gh-proxy, with the static site removed.

## Files
- `upstream/index.js`: upstream source synced from hunshcn/gh-proxy
- `src/index.js`: optimized Worker implementation used for deployment
- `.github/workflows/sync-upstream.yml`: scheduled sync job

## Deploy
1. Update `wrangler.toml` with your Cloudflare account ID and name if needed.
2. Run `wrangler deploy`.

## Usage
- `https://<worker-domain>/https://github.com/user/repo/blob/branch/file`
- `https://<worker-domain>/?q=https://github.com/user/repo/blob/branch/file`
