'use strict'

// Prefix; for custom routing like example.com/gh/*, set to '/gh/' (ending slash required).
const PREFIX = '/'
// Use jsDelivr mirror for branch files; 0 disables.
const Config = {
  jsdelivr: 0,
}

const MAX_REDIRECTS = 5
const whiteList = [] // allow all when empty

/** @type {ResponseInit} */
const PREFLIGHT_INIT = {
  status: 204,
  headers: new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    'access-control-max-age': '1728000',
  }),
}

const RE_RELEASE_ARCHIVE = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const RE_BLOB_RAW = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const RE_GIT_INFO = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const RE_RAW_HOST = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const RE_GIST = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const RE_TAGS = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i

/**
 * @param {any} body
 * @param {number} status
 * @param {Object<string, string>} headers
 */
function makeRes(body, status = 200, headers = {}) {
  headers['access-control-allow-origin'] = '*'
  return new Response(body, { status, headers })
}

/**
 * @param {string} urlStr
 */
function newUrl(urlStr) {
  try {
    return new URL(urlStr)
  } catch (err) {
    return null
  }
}

export default {
  async fetch(request) {
    try {
      return await fetchHandler(request)
    } catch (err) {
      console.error('cfworker error:', err)
      return makeRes('Internal Server Error', 502)
    }
  },
}

function checkUrl(u) {
  for (let i of [RE_RELEASE_ARCHIVE, RE_BLOB_RAW, RE_GIT_INFO, RE_RAW_HOST, RE_GIST, RE_TAGS]) {
    if (u.search(i) === 0) {
      return true
    }
  }
  return false
}

/**
 * @param {Request} req
 */
async function fetchHandler(req) {
  const urlStr = req.url
  const urlObj = new URL(urlStr)
  let path = urlObj.searchParams.get('q')
  if (path) {
    return Response.redirect('https://' + urlObj.host + PREFIX + path, 301)
  }
  // CF Workers merges '//' in the path into '/'
  path = urlObj.href.slice(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')
  if (!path) {
    return makeRes('Forbidden', 403)
  }
  if (path.search(RE_RELEASE_ARCHIVE) === 0 || path.search(RE_GIST) === 0 || path.search(RE_TAGS) === 0 || path.search(RE_GIT_INFO) === 0) {
    return httpHandler(req, path)
  } else if (path.search(RE_BLOB_RAW) === 0) {
    if (Config.jsdelivr) {
      const jsdelivrUrl = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh')
      return Response.redirect(jsdelivrUrl, 302)
    } else {
      path = path.replace('/blob/', '/raw/')
      return httpHandler(req, path)
    }
  } else if (path.search(RE_RAW_HOST) === 0) {
    if (Config.jsdelivr) {
      const jsdelivrUrl = path.replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1').replace(/^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/, 'https://cdn.jsdelivr.net/gh')
      return Response.redirect(jsdelivrUrl, 302)
    } else {
      return httpHandler(req, path)
    }
  } else {
    return makeRes('Not Found', 404)
  }
}

/**
 * @param {Request} req
 * @param {string} pathname
 */
function httpHandler(req, pathname) {
  const reqHdrRaw = req.headers

  // preflight
  if (req.method === 'OPTIONS' && reqHdrRaw.has('access-control-request-headers')) {
    return new Response(null, PREFLIGHT_INIT)
  }

  const reqHdrNew = new Headers(reqHdrRaw)

  let urlStr = pathname
  let flag = !Boolean(whiteList.length)
  for (let i of whiteList) {
    if (urlStr.includes(i)) {
      flag = true
      break
    }
  }
  if (!flag) {
    return new Response('blocked', { status: 403 })
  }
  if (urlStr.search(/^https?:\/\//) !== 0) {
    urlStr = 'https://' + urlStr
  }
  const urlObj = newUrl(urlStr)
  if (!urlObj) {
    return makeRes('Bad Request', 400)
  }

  /** @type {RequestInit} */
  const reqInit = {
    method: req.method,
    headers: reqHdrNew,
    redirect: 'manual',
    body: req.body,
  }
  return proxy(urlObj, reqInit)
}

/**
 * @param {URL} urlObj
 * @param {RequestInit} reqInit
 */
async function proxy(urlObj, reqInit, redirectCount = 0) {
  const res = await fetch(urlObj.href, reqInit)
  const resHdrOld = res.headers
  const resHdrNew = new Headers(resHdrOld)

  const status = res.status

  if (resHdrNew.has('location')) {
    let _location = resHdrNew.get('location')
    if (checkUrl(_location)) {
      resHdrNew.set('location', PREFIX + _location)
    } else {
      const locationUrl = newUrl(_location)
      if (!locationUrl) {
        return makeRes('Bad redirect URL', 502)
      }
      if (redirectCount >= MAX_REDIRECTS) {
        return makeRes('Too many redirects', 508)
      }
      reqInit.redirect = 'follow'
      return proxy(locationUrl, reqInit, redirectCount + 1)
    }
  }
  resHdrNew.set('access-control-expose-headers', '*')
  resHdrNew.set('access-control-allow-origin', '*')

  resHdrNew.delete('content-security-policy')
  resHdrNew.delete('content-security-policy-report-only')
  resHdrNew.delete('clear-site-data')

  return new Response(res.body, {
    status,
    headers: resHdrNew,
  })
}
