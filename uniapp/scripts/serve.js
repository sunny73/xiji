#!/usr/bin/env node
/**
 * H5 构建产物的预览服务器：静态托管 + /api 反向代理。
 *
 *     cd uniapp && npm run build:h5 && node scripts/serve.js
 *     → http://127.0.0.1:5174
 *
 * 为什么需要它：
 *   1. dist 是纯静态文件，直接双击打开是 file://，fetch 会被 CORS 拦死
 *   2. config.js 里 H5 的 baseUrl 是相对路径 /api/v1（走同源，不动后端 CORS），
 *      必须有东西把它转发到后端
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')

const args = process.argv.slice(2)
function argValue(flag, fallback) {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const PORT = parseInt(argValue('--port', '5174'), 10)
const API_TARGET = argValue('--api', 'http://127.0.0.1:8000')
const ROOT = path.resolve(__dirname, '..', 'dist', 'build', 'h5')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

if (!fs.existsSync(ROOT)) {
  console.error('找不到 ' + ROOT)
  console.error('先跑：npm run build:h5')
  process.exit(1)
}

function proxy(req, res) {
  const target = new URL(req.url, API_TARGET)
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const headers = Object.assign({}, req.headers)
    delete headers.host
    delete headers['accept-encoding']
    if (body.length) headers['content-length'] = body.length

    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers)
        upRes.pipe(res)
      }
    )
    upstream.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          detail: '连不上后端（' + API_TARGET + '）：' + err.message,
          hint: '先启动后端：docker compose up -d',
        })
      )
    })
    if (body.length) upstream.write(body)
    upstream.end()
  })
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0])
    if (urlPath.indexOf('/api/') === 0 || urlPath === '/healthz') return proxy(req, res)

    let rel = urlPath.replace(/^\//, '')
    let file = path.join(ROOT, rel || 'index.html')
    if (!file.startsWith(ROOT)) {
      res.writeHead(403)
      return res.end('403')
    }
    // SPA 路由回退（uni-app H5 默认用 hash 模式，这里只是兜底）
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, 'index.html')
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        return res.end('404 ' + rel)
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      res.end(data)
    })
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log('')
    console.log('  \033[32m分红管家 uni-app · H5 预览\033[0m')
    console.log('')
    console.log('    \033[1mhttp://127.0.0.1:' + PORT + '\033[0m')
    console.log('')
    console.log('  \033[2m接口代理\033[0m  /api/* -> ' + API_TARGET)
    console.log('  \033[2m静态目录\033[0m  ' + ROOT)
    console.log('')
  })
