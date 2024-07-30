import type { Server } from 'http'
import * as https from 'https'
import { app } from 'electron'
import type { Logger } from './RemoteLogger'

export const PROXY_HOSTS = [
  { host: 'www.pathofexile.com', official: true },
  { host: 'ru.pathofexile.com', official: true },
  { host: 'pathofexile.tw', official: true },
  { host: 'poe.game.daum.net', official: true },
  { host: 'poe.ninja', official: false },
  { host: 'www.poeprices.info', official: false },
  { host: 'poe.game.qq.com', official: true },
  { host: 'www.poelab.com', official: false },
  { host: 'pub-feb51ef2e03741399e6a3d2d09a07601.r2.dev', official: false },
  { host: 'gitee.com', official: false }
]

export class HttpProxy {
  cookiesForPoe = new Map<string, string>()
  private cookies: string = ''
  private realm: string = ''

  constructor (
    server: Server,
    logger: Logger
  ) {
    server.addListener('request', (req, res) => {
      if (!req.url?.startsWith('/proxy/')) return
      const host = req.url.split('/', 3)[2]

      const official = PROXY_HOSTS.find(entry => entry.host === host)?.official
      if (official === undefined) return req.destroy()


      let cookie = (official)
          ? Array.from(this.cookiesForPoe.entries())
              .map(([key, value]) => `${key}=${value}`)
              .join('; ')
          : ''
      if (this.realm === 'pc-tencent' && host === 'poe.game.qq.com'){
        cookie = this.cookies}

      const options = this.realm === 'pc-tencent' && host === 'poe.game.qq.com' ? {
        method: req.method,
        headers: {
          ...req.headers,
          host: host,
          cookie: cookie,
          'user-agent': app.userAgentFallback,
          Origin: 'https://poe.game.qq.com',
          Host: 'poe.game.qq.com',
          'X-Requested-With': 'XMLHttpRequest'
        },
        rejectUnauthorized: false
      } : {
        method: req.method,
        headers: {
          ...req.headers,
          host: host,
          cookie: cookie,
          'user-agent': app.userAgentFallback
        },
        rejectUnauthorized: false
      }
      const proxyReq = https.request(
        'https://' + req.url.slice('/proxy/'.length),
          options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode!, proxyRes.statusMessage!, proxyRes.rawHeaders)
          proxyRes.pipe(res)
        })
      proxyReq.addListener('error', (err) => {
        logger.write(`error [cors-proxy] ${err.message} (${host})`)
        res.destroy(err)
      })
      req.pipe(proxyReq)
    })
  }

  updateCookies( cookies:string, realm:string ) {
    this.cookies = cookies
    this.realm = realm
  }

}
