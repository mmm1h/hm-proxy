'use strict';

const PREFIX = '/';
const PREFIX_PATH = PREFIX.endsWith('/') ? PREFIX : `${PREFIX}/`;
const USE_JSDELIVR = false;
const WHITE_LIST = []; // empty = allow all

const PATTERN_RELEASE_ARCHIVE = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i;
const PATTERN_BLOB_RAW = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i;
const PATTERN_GIT_INFO = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i;
const PATTERN_RAW_HOST = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i;
const PATTERN_GIST = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i;
const PATTERN_TAGS = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i;

const ALLOWED_PATTERNS = [
  PATTERN_RELEASE_ARCHIVE,
  PATTERN_BLOB_RAW,
  PATTERN_GIT_INFO,
  PATTERN_RAW_HOST,
  PATTERN_GIST,
  PATTERN_TAGS,
];

const DIRECT_PATTERNS = [
  PATTERN_RELEASE_ARCHIVE,
  PATTERN_GIT_INFO,
  PATTERN_GIST,
  PATTERN_TAGS,
];

const PREFLIGHT_INIT = {
  status: 204,
  headers: new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
    'access-control-max-age': '1728000',
  }),
};

const MAX_REDIRECTS = 5;

export default {
  async fetch(request) {
    try {
      return await handleRequest(request);
    } catch (err) {
      const message = err && err.stack ? err.stack : String(err);
      return makeResponse(`cfworker error:\n${message}`, 502);
    }
  },
};

function makeResponse(body, status = 200, headers = {}) {
  const resHeaders = new Headers(headers);
  resHeaders.set('access-control-allow-origin', '*');
  return new Response(body, { status, headers: resHeaders });
}

function safeUrl(urlStr) {
  try {
    return new URL(urlStr);
  } catch (err) {
    return null;
  }
}

function normalizeTarget(rawPath) {
  if (!rawPath) {
    return '';
  }
  return rawPath.replace(/^https?:\/+/, 'https://');
}

function isAllowed(urlStr) {
  return ALLOWED_PATTERNS.some((re) => re.test(urlStr));
}

function classifyTarget(target) {
  if (DIRECT_PATTERNS.some((re) => re.test(target))) {
    return 'direct';
  }
  if (PATTERN_BLOB_RAW.test(target)) {
    return 'blob';
  }
  if (PATTERN_RAW_HOST.test(target)) {
    return 'raw';
  }
  return '';
}

function isWhitelisted(urlStr) {
  if (!WHITE_LIST.length) {
    return true;
  }
  return WHITE_LIST.some((token) => urlStr.includes(token));
}

function ensureHttps(urlStr) {
  if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
    return urlStr;
  }
  return `https://${urlStr}`;
}

function buildRequestInit(request) {
  const headers = new Headers(request.headers);
  headers.delete('host');

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  return init;
}

function toRawGitHub(target) {
  const urlObj = safeUrl(ensureHttps(target));
  if (!urlObj) {
    return null;
  }
  if (urlObj.hostname !== 'github.com') {
    return urlObj.href;
  }

  const parts = urlObj.pathname.split('/').filter(Boolean);
  if (parts.length < 4) {
    return urlObj.href;
  }

  const [user, repo, kind, branch, ...rest] = parts;
  if (kind === 'blob') {
    urlObj.pathname = `/${user}/${repo}/raw/${branch}/${rest.join('/')}`;
  }

  return urlObj.href;
}

function toJsdelivrUrl(target) {
  const urlObj = safeUrl(ensureHttps(target));
  if (!urlObj) {
    return null;
  }

  if (urlObj.hostname === 'github.com') {
    const parts = urlObj.pathname.split('/').filter(Boolean);
    if (parts.length < 4) {
      return null;
    }
    const [user, repo, kind, branch, ...rest] = parts;
    if (kind !== 'blob' && kind !== 'raw') {
      return null;
    }
    const path = rest.join('/');
    return `https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}/${path}`;
  }

  if (urlObj.hostname === 'raw.githubusercontent.com' || urlObj.hostname === 'raw.github.com') {
    const parts = urlObj.pathname.split('/').filter(Boolean);
    if (parts.length < 3) {
      return null;
    }
    const [user, repo, branch, ...rest] = parts;
    const path = rest.join('/');
    return `https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}/${path}`;
  }

  return null;
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');

  if (query) {
    return Response.redirect(`https://${url.host}${PREFIX_PATH}${query}`, 301);
  }

  const rawPath = url.href.slice(url.origin.length + PREFIX_PATH.length);
  const target = normalizeTarget(rawPath);

  if (!target) {
    return makeResponse('Not Found', 404);
  }

  const kind = classifyTarget(target);
  if (!kind) {
    return makeResponse('Not Found', 404);
  }

  if (kind === 'blob') {
    if (USE_JSDELIVR) {
      const jsdelivr = toJsdelivrUrl(target);
      if (jsdelivr) {
        return Response.redirect(jsdelivr, 302);
      }
    }
    const rawTarget = toRawGitHub(target) || target;
    return proxyRequest(request, rawTarget);
  }

  if (kind === 'raw') {
    if (USE_JSDELIVR) {
      const jsdelivr = toJsdelivrUrl(target);
      if (jsdelivr) {
        return Response.redirect(jsdelivr, 302);
      }
    }
    return proxyRequest(request, target);
  }

  return proxyRequest(request, target);
}

function proxyRequest(request, targetUrl) {
  const reqHeaders = request.headers;

  if (request.method === 'OPTIONS' && reqHeaders.has('access-control-request-headers')) {
    return new Response(null, PREFLIGHT_INIT);
  }

  const urlStr = ensureHttps(targetUrl);
  if (!isWhitelisted(urlStr)) {
    return makeResponse('blocked', 403);
  }

  const urlObj = safeUrl(urlStr);
  if (!urlObj) {
    return makeResponse('Bad Request', 400);
  }

  const reqInit = buildRequestInit(request);
  return proxyFetch(urlObj, reqInit, 0);
}

async function proxyFetch(urlObj, reqInit, redirectCount) {
  const res = await fetch(urlObj.href, reqInit);
  const resHeaders = new Headers(res.headers);
  const status = res.status;

  if (resHeaders.has('location')) {
    const location = resHeaders.get('location');
    let resolved;
    try {
      resolved = new URL(location, urlObj.href);
    } catch (err) {
      return makeResponse('Bad Request', 400);
    }

    if (isAllowed(resolved.href)) {
      resHeaders.set('location', PREFIX_PATH + resolved.href);
    } else {
      if (redirectCount >= MAX_REDIRECTS) {
        return makeResponse('Too many redirects', 508);
      }
      return proxyFetch(resolved, reqInit, redirectCount + 1);
    }
  }

  resHeaders.set('access-control-expose-headers', '*');
  resHeaders.set('access-control-allow-origin', '*');

  resHeaders.delete('content-security-policy');
  resHeaders.delete('content-security-policy-report-only');
  resHeaders.delete('clear-site-data');

  return new Response(res.body, {
    status,
    headers: resHeaders,
  });
}
