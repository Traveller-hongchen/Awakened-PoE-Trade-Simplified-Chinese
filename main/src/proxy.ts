import type { FastifyInstance } from 'fastify'
import fastifyProxy from '@fastify/http-proxy'
import { app } from 'electron'

export const PROXY_HOSTS = [
  { host: 'www.pathofexile.com', official: true },
  { host: 'ru.pathofexile.com', official: true },
  { host: 'web.poe.garena.tw', official: true },
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
  private poesessid: string = ''
  private realm: string = ''

  constructor (
    server: FastifyInstance
  ) {
    for (const { host, official } of PROXY_HOSTS) {
      server.register(fastifyProxy, {
        upstream: `https://${host}`,
        prefix: `/proxy/${host}`,
        replyOptions: {
          rewriteRequestHeaders: (_, headers) => {
            if (this.realm === 'pc-tencent' && host === 'poe.game.qq.com'){
              this.cookiesForPoe.set('POESESSID', this.poesessid)
            }
            const cookie = (official)
              ? Array.from(this.cookiesForPoe.entries())
                  .map(([key, value]) => `${key}=${value}`)
                  .join('; ')
              : undefined

            return {
              ...headers,
              cookie,
              'user-agent': app.userAgentFallback
            }
          }
        }
      })
    }
  }

  updateCookies( poesessid:string, realm:string ) {
    this.poesessid = poesessid
    this.realm = realm
  }

}
