#!/usr/bin/env node
/**
 * H5 预览服务器。
 *
 *     cd h5 && node server.js [--port 3000] [--api http://127.0.0.1:8000]
 *     → http://127.0.0.1:3000
 *
 * 为什么要有这个服务（而不是直接打开 index.html）：
 *   1. file:// 下 fetch 会被 CORS 拦死，必须有个 http 源
 *   2. 它把 /api/* 反向代理到后端，于是浏览器视角是**同源**的，
 *      完全不需要动后端的 CORS_ORIGINS（Docker 里那个默认是空的）
 *   3. tabBar 图标在 miniprogram/assets 下，需要单独映射出去
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

const PORT = parseInt(argValue('--port', '3000'), 10)
const API_TARGET = argValue('--api', 'http://127.0.0.1:8000')

const H5_ROOT = __dirname
const MP_ASSETS = path.resolve(__dirname, '..', 'miniprogram', 'assets')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function sendFile(res, filePath) {
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404 ' + path.basename(filePath))
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(data)
  })
}

/** 把 /api/* 转发给后端，原样回传状态码和响应体 */
function proxy(req, res) {
  const target = new URL(req.url, API_TARGET)
  const chunks = []
  req.on('data', function (c) {
    chunks.push(c)
  })
  req.on('end', function () {
    const body = Buffer.concat(chunks)
    const headers = Object.assign({}, req.headers)
    delete headers.host
    delete headers['accept-encoding'] // 让后端返回未压缩内容，转发更简单
    if (body.length) headers['content-length'] = body.length

    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers: headers,
      },
      function (upRes) {
        res.writeHead(upRes.statusCode, upRes.headers)
        upRes.pipe(res)
      }
    )

    upstream.on('error', function (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          detail: '连不上后端（' + API_TARGET + '）：' + err.message,
          hint: '先启动后端：docker compose up -d   或   cd backend && .venv/bin/uvicorn app.main:app',
        })
      )
    })

    if (body.length) upstream.write(body)
    upstream.end()
  })
}

const server = http.createServer(function (req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0])

  if (urlPath.indexOf('/api/') === 0) return proxy(req, res)

  // tabBar 图标等静态资源
  if (urlPath.indexOf('/mp-assets/') === 0) {
    const rel = urlPath.replace('/mp-assets/', '')
    const target = path.join(MP_ASSETS, rel)
    if (!target.startsWith(MP_ASSETS)) {
      res.writeHead(403)
      return res.end('403')
    }
    return sendFile(res, target)
  }

  // 预览自身
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '')
  const target = path.join(H5_ROOT, rel)
  if (!target.startsWith(H5_ROOT)) {
    res.writeHead(403)
    return res.end('403')
  }
  if (!fs.existsSync(target) && !path.extname(target)) {
    // 没有扩展名且不存在 → 当作前端路由，回 index.html
    return sendFile(res, path.join(H5_ROOT, 'index.html'))
  }
  sendFile(res, target)
})

server.listen(PORT, '127.0.0.1', function () {
  console.log('')
  console.log('  \033[32m分红管家 H5 预览\033[0m')
  console.log('')
  console.log('    \033[1mhttp://127.0.0.1:' + PORT + '\033[0m')
  console.log('')
  console.log('  \033[2m接口代理\033[0m  /api/*  ->  ' + API_TARGET)
  console.log('  \033[2m静态资源\033[0m  ' + H5_ROOT)
  console.log('  \033[2m小程序图标\033[0m /mp-assets/*  ->  ' + MP_ASSETS)
  console.log('')
})
