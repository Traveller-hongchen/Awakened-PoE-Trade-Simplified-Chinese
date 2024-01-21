import { shallowRef, watch, readonly } from 'vue'
import { createGlobalState } from '@vueuse/core'
import { Host } from '@/web/background/IPC'
import { useLeagues } from './Leagues'
import { BaseType, CLIENT_STRINGS as _$, ITEM_BY_REF } from '@/assets/data'
import pako from 'pako'
import { Buffer } from 'buffer'

interface NinjaDenseInfo {
  chaos: number
  graph: Array<number | null>
  name: string
  variant?: string
}

type PriceDatabase = Array<{ ns: string, url: string, lines: string }>
type PriceDatabaseCN = Array<{ name: string, calculated: number, searchCode: string, history: Array<number | null> }>
const RETRY_INTERVAL_MS = 4 * 60 * 1000
const UPDATE_INTERVAL_MS = 31 * 60 * 1000
const INTEREST_SPAN_MS = 20 * 60 * 1000

interface DbQuery {
  ns: string
  name: string
  variant: string | undefined
}

export interface CurrencyValue {
  min: number
  max: number
  currency: 'chaos' | 'div'
}

export const usePoeninja = createGlobalState(() => {
  const leagues = useLeagues()

  const xchgRate = shallowRef<number | undefined>(undefined)

  const isLoading = shallowRef(false)
  let PRICES_DB: PriceDatabase = []
  let PRICES_DB_CN: PriceDatabaseCN = []
  let lastUpdateTime = 0
  let downloadController: AbortController | undefined
  let lastInterestTime = 0

  async function load (force: boolean = false) {
    const league = leagues.selected.value
    if (!league || !league.isPopular || league.realm === 'pc-garena') return

    if (!force && (
      (Date.now() - lastUpdateTime) < UPDATE_INTERVAL_MS ||
      (Date.now() - lastInterestTime) > INTEREST_SPAN_MS
    )) return
    if (downloadController) downloadController.abort()

    try {
      isLoading.value = true
      downloadController = new AbortController()
      let divine

      if (league.realm === 'pc-ggg') {
        const response = await Host.proxy(`poe.ninja/api/data/DenseOverviews?league=${league.id}&language=en`, {
          signal: downloadController.signal
        })
        const jsonBlob = await response.text()

        PRICES_DB = splitJsonBlob(jsonBlob) as PriceDatabase
        divine = findPriceByQuery({ ns: 'ITEM', name: 'Divine Orb', variant: undefined })
      } else if (league.realm === 'pc-tencent') {
        let jsonurl: string
        switch (league.id) {
          case '永久':
            jsonurl = 'pub-feb51ef2e03741399e6a3d2d09a07601.r2.dev/price1.txt'
            break
          case 'S24赛季':
            jsonurl = 'pub-feb51ef2e03741399e6a3d2d09a07601.r2.dev/price2.txt'
            break
          default:
            return
        }
        let response
        try {
          response = await Host.proxy(jsonurl, {
            signal: downloadController.signal
          })
        } catch (e) {
          response = await Host.proxy(jsonurl.replace('pub-feb51ef2e03741399e6a3d2d09a07601.r2.dev', 'gitee.com/hhzxxx/exilence-next-tx-release/raw/master'), {
            signal: downloadController.signal
          })
        }
        const compressedBuffer = Buffer.from(await response.text(), 'base64')
        const jsonBlob = pako.ungzip(compressedBuffer, { to: 'string' })
        PRICES_DB_CN = splitJsonBlob(jsonBlob) as PriceDatabaseCN
        divine = findPriceByQuery({ ns: 'ITEM', name: 'Divine Orb', variant: undefined })
      }
      if (divine && divine.chaos >= 30) {
        xchgRate.value = divine.chaos
      }
      lastUpdateTime = Date.now()
    } finally {
      isLoading.value = false
    }
  }

  function queuePricesFetch () {
    lastInterestTime = Date.now()
    load()
  }

  function selectedLeagueToUrl (): string {
    const league = leagues.selectedId.value!
    switch (league) {
      case 'Standard': return 'standard'
      case 'Hardcore': return 'hardcore'
      default:
        return (league.startsWith('Hardcore ')) ? 'challengehc' : 'challenge'
    }
  }

  function findPriceByQuery (query: DbQuery) {
    const league = leagues.selected.value
    if (!league || !league.isPopular || league.realm === 'pc-garena') return

    if (league.realm === 'pc-ggg') {
    // NOTE: order of keys is important
      const searchString = JSON.stringify({
        name: query.name,
        variant: query.variant,
        chaos: 0
      }).replace(':0}', ':')

      for (const { ns, url, lines } of PRICES_DB) {
        if (ns !== query.ns) continue

        const startPos = lines.indexOf(searchString)
        if (startPos === -1) continue
        const endPos = lines.indexOf('}', startPos)

        const info: NinjaDenseInfo = JSON.parse(lines.slice(startPos, endPos + 1))

        return {
          ...info,
          url: `https://poe.ninja/${selectedLeagueToUrl()}/${url}/${denseInfoToDetailsId(info)}`
        }
      }
    } else {
      const qualities = new Map([
        ['anomalous', _$.QUALITY_ANOMALOUS.toString().slice(2, 5)],
        ['divergent', _$.QUALITY_DIVERGENT.toString().slice(2, 5)],
        ['phantasmal', _$.QUALITY_PHANTASMAL.toString().slice(2, 5)]
      ])

      let itemName: string
      let isVariantGem: boolean = false
      itemName = query.name
      if (query.ns === 'GEM' && query.variant === '1') {
        itemName = query.name.split(' ').slice(1).join(' ')
        isVariantGem = true
      }
      const item = ITEM_BY_REF(query.ns as BaseType['namespace'], itemName)![0]

      for (const { name, calculated, searchCode, history } of PRICES_DB_CN) {
        if (name === (isVariantGem ? qualities.get(query.name.split(' ')![0].toLowerCase()) as string + item.name : item.name)) {
          const info: NinjaDenseInfo = {
            chaos: calculated,
            graph: Array.from(history, e => e ? (e - calculated) / calculated : null),
            name,
            variant: query.variant
          }
          return {
            ...info,
            url: `${searchCode}`
          }
        }
      }
    }
    return null
  }

  function autoCurrency (value: number | [number, number]): CurrencyValue {
    if (Array.isArray(value)) {
      if (value[1] > (xchgRate.value || 9999)) {
        return { min: chaosToStable(value[0]), max: chaosToStable(value[1]), currency: 'div' }
      }
      return { min: value[0], max: value[1], currency: 'chaos' }
    }
    if (value > ((xchgRate.value || 9999) * 0.94)) {
      if (value < ((xchgRate.value || 9999) * 1.06)) {
        return { min: 1, max: 1, currency: 'div' }
      } else {
        return { min: chaosToStable(value), max: chaosToStable(value), currency: 'div' }
      }
    }
    return { min: value, max: value, currency: 'chaos' }
  }

  function chaosToStable (count: number) {
    return count / (xchgRate.value || 9999)
  }

  setInterval(() => {
    load()
  }, RETRY_INTERVAL_MS)

  watch(leagues.selectedId, () => {
    xchgRate.value = undefined
    PRICES_DB = []
    PRICES_DB_CN = []
    load(true)
  })

  return {
    xchgRate: readonly(xchgRate),
    findPriceByQuery,
    autoCurrency,
    queuePricesFetch,
    initialLoading: () => isLoading.value && (!PRICES_DB.length || PRICES_DB_CN.length)
  }
})

function denseInfoToDetailsId (info: NinjaDenseInfo): string {
  return ((info.variant) ? `${info.name}, ${info.variant}` : info.name)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9:\- ]/g, '')
    .toLowerCase()
    .replace(/ /g, '-')
}

function splitJsonBlob (jsonBlob: string) {
  const leagues = useLeagues()
  const league = leagues.selected.value

  if (league?.realm === 'pc-ggg') {
    const NINJA_OVERVIEW = '{"type":"'
    const NAMESPACE_MAP: Array<{ ns: string, url: string, type: string }> = [
      { ns: 'ITEM', url: 'currency', type: 'Currency' },
      { ns: 'ITEM', url: 'fragments', type: 'Fragment' },
      { ns: 'ITEM', url: 'delirium-orbs', type: 'DeliriumOrb' },
      { ns: 'ITEM', url: 'scarabs', type: 'Scarab' },
      { ns: 'ITEM', url: 'artifacts', type: 'Artifact' },
      { ns: 'ITEM', url: 'base-types', type: 'BaseType' },
      { ns: 'ITEM', url: 'fossils', type: 'Fossil' },
      { ns: 'ITEM', url: 'resonators', type: 'Resonator' },
      { ns: 'ITEM', url: 'incubators', type: 'Incubator' },
      { ns: 'ITEM', url: 'oils', type: 'Oil' },
      { ns: 'ITEM', url: 'vials', type: 'Vial' },
      { ns: 'ITEM', url: 'invitations', type: 'Invitation' },
      { ns: 'ITEM', url: 'blighted-maps', type: 'BlightedMap' },
      { ns: 'ITEM', url: 'blight-ravaged-maps', type: 'BlightRavagedMap' },
      { ns: 'ITEM', url: 'essences', type: 'Essence' },
      { ns: 'ITEM', url: 'maps', type: 'Map' },
      { ns: 'ITEM', url: 'tattoos', type: 'Tattoo' },
      { ns: 'ITEM', url: 'omens', type: 'Omen' },
      { ns: 'DIVINATION_CARD', url: 'divination-cards', type: 'DivinationCard' },
      { ns: 'CAPTURED_BEAST', url: 'beasts', type: 'Beast' },
      { ns: 'UNIQUE', url: 'unique-jewels', type: 'UniqueJewel' },
      { ns: 'UNIQUE', url: 'unique-flasks', type: 'UniqueFlask' },
      { ns: 'UNIQUE', url: 'unique-weapons', type: 'UniqueWeapon' },
      { ns: 'UNIQUE', url: 'unique-armours', type: 'UniqueArmour' },
      { ns: 'UNIQUE', url: 'unique-accessories', type: 'UniqueAccessory' },
      { ns: 'UNIQUE', url: 'unique-maps', type: 'UniqueMap' },
      { ns: 'UNIQUE', url: 'unique-relics', type: 'UniqueRelic' },
      { ns: 'GEM', url: 'skill-gems', type: 'SkillGem' }
    ]

    const database: PriceDatabase = []
    let startPos = jsonBlob.indexOf(NINJA_OVERVIEW)
    if (startPos === -1) return []

    while (true) {
      const endPos = jsonBlob.indexOf(NINJA_OVERVIEW, startPos + 1)

      const type = jsonBlob.slice(
        startPos + NINJA_OVERVIEW.length,
        jsonBlob.indexOf('"', startPos + NINJA_OVERVIEW.length)
      )
      const lines = jsonBlob.slice(startPos, (endPos === -1) ? jsonBlob.length : endPos)

      const isSupported = NAMESPACE_MAP.find(entry => entry.type === type)
      if (isSupported) {
        database.push({ ns: isSupported.ns, url: isSupported.url, lines })
      }

      if (endPos === -1) break
      startPos = endPos
    }
    return database
  } else if (league?.realm === 'pc-tencent') {
    const jsonArray = JSON.parse(jsonBlob)
    const database: PriceDatabaseCN = []
    for (const json of jsonArray) {
      database.push({ name: json.name, calculated: json.calculated, searchCode: json.searchCode, history: json.history })
    }
    return database
  }
}

export function displayRounding (value: number, fraction: boolean = false): string {
  if (fraction && Math.abs(value) < 1) {
    if (value === 0) return '0'
    const r = `1\u200A/\u200A${displayRounding(1 / value)}`
    return r === '1\u200A/\u200A1' ? '1' : r
  }
  if (Math.abs(value) < 10) {
    return Number(value.toFixed(1)).toString().replace('.', '\u200A.\u200A')
  }
  return Math.round(value).toString()
}
