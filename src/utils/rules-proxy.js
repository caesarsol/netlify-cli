const path = require('path')
const fs = require('fs')
const url = require('url')
const redirector = require('netlify-redirector')
const chokidar = require('chokidar')
const cookie = require('cookie')
const { parseRedirectsFormat, parseNetlifyConfig } = require('netlify-redirect-parser')
const { NETLIFYDEVWARN, NETLIFYDEVLOG } = require('../utils/logo')
const { fileExistsAsync } = require('../lib/fs')

async function parseFile(filePath) {
  if (!(await fileExistsAsync(filePath))) {
    return []
  }

  const parser = path.basename(filePath) === '_redirects' ? parseRedirectsFormat : parseNetlifyConfig
  const { success, errors } = await parser(filePath)
  if (errors.length !== 0) {
    console.error(`${NETLIFYDEVWARN} Warnings while parsing ${path.basename(filePath)} file:`)
    errors.forEach((err) => {
      console.error(`  ${err.lineNum}: ${err.line} -- ${err.reason}`)
    })
  }
  return success
}

module.exports.parseFile = parseFile

async function parseRules(configFiles) {
  const results = await Promise.all(configFiles.map(parseFile))
  return [].concat(...results)
}

module.exports.parseRules = parseRules

function onChanges(files, cb) {
  files.forEach((file) => {
    const watcher = chokidar.watch(file)
    watcher.on('change', cb)
    watcher.on('unlink', cb)
  })
}

module.exports.onChanges = onChanges

function getLanguage(headers) {
  if (headers['accept-language']) {
    return headers['accept-language'].split(',')[0].slice(0, 2)
  }
  return 'en'
}

module.exports.getLanguage = getLanguage

function getCountry() {
  return 'us'
}

module.exports.createRewriter = async function createRewriter({ distDir, projectDir, jwtSecret, jwtRole, configPath }) {
  let matcher = null
  const configFiles = [
    ...new Set(
      [path.resolve(distDir, '_redirects'), path.resolve(projectDir, '_redirects')].concat(
        configPath ? path.resolve(configPath) : []
      )
    ),
  ].filter((f) => f !== projectDir)
  let rules = await parseRules(configFiles)

  onChanges(configFiles, async () => {
    console.log(
      `${NETLIFYDEVLOG} Reloading redirect rules from`,
      configFiles.filter(fs.existsSync).map((p) => path.relative(projectDir, p))
    )
    rules = await parseRules(configFiles)
    matcher = null
  })

  const getMatcher = async () => {
    if (matcher) return matcher

    if (rules.length !== 0) {
      return (matcher = await redirector.parseJSON(JSON.stringify(rules), {
        jwtSecret: jwtSecret || 'secret',
        jwtRole: jwtRole || 'app_metadata.authorization.roles',
      }))
    }
    return {
      match() {
        return null
      },
    }
  }

  return function (req, res, next) {
    getMatcher().then((matcher) => {
      const reqUrl = new url.URL(
        req.url,
        `${req.protocol || (req.headers.scheme && req.headers.scheme + ':') || 'http:'}//${
          req.hostname || req.headers.host
        }`
      )
      const cookieValues = cookie.parse(req.headers.cookie || '')
      const headers = {
        'x-language': cookieValues.nf_lang || getLanguage(req.headers),
        'x-country': cookieValues.nf_country || getCountry(req),
        ...req.headers,
      }

      // Definition: https://github.com/netlify/libredirect/blob/e81bbeeff9f7c260a5fb74cad296ccc67a92325b/node/src/redirects.cpp#L28-L60
      const matchReq = {
        scheme: reqUrl.protocol.replace(/:.*$/, ''),
        host: reqUrl.hostname,
        path: reqUrl.pathname,
        query: reqUrl.search.slice(1),
        headers,
        cookieValues,
        getHeader: (name) => headers[name.toLowerCase()] || '',
        getCookie: (key) => cookieValues[key] || '',
      }
      const match = matcher.match(matchReq)
      if (match) return next(match)

      next()
    })
  }
}
