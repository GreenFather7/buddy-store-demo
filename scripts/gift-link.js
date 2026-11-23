// Ссылка на подаренную гифт-карту: сервис, номинал, регион и код лежат в части адреса после «#».
// Эта часть не уходит на сервер (ни в запросы, ни в логи хостинга) — её видит только тот,
// кому покупатель отправил ссылку. По ней открывается карта с кнопкой «Скопировать код».

import { BRANDS } from './brands.js?v=1795435815'

const GIFT_PARAM = 'gift'
const MAX_CODES = 5
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{2,62}[A-Za-z0-9]$/
const REGION_CODE_PATTERN = /^[A-Za-z]{2}$/
const MAX_TEXT = 40
/** Служебный параметр перезагрузки свежей сборки (fresh.js) в ссылку не переносим. */
const BUILD_PARAM = 'b'

/**
 * @typedef {{ brand: string, nominal: string, region: string, regionCode: string, codes: string[] }} Gift
 */

const toBase64Url = (text) => {
  const bytes = new TextEncoder().encode(text)
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value) => {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

const shortText = (value) => {
  const text = String(value ?? '').trim()
  return text.length <= MAX_TEXT && !/[\u0000-\u001f<>]/.test(text) ? text : null
}

/**
 * Проверяет подарок: известный сервис, 1–5 кодов из букв, цифр, дефисов и пробелов,
 * короткие номинал и регион. Всё остальное — null: такую ссылку не показываем.
 * @returns {Gift|null}
 */
export const validGift = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const brand = String(raw.b ?? raw.brand ?? '')
  const codes = raw.c ?? raw.codes
  const nominal = shortText(raw.n ?? raw.nominal)
  const region = shortText(raw.r ?? raw.region)
  const regionCode = String(raw.rc ?? raw.regionCode ?? '')
  const isValid =
    Object.hasOwn(BRANDS, brand) &&
    Array.isArray(codes) &&
    codes.length > 0 &&
    codes.length <= MAX_CODES &&
    codes.every((code) => typeof code === 'string' && CODE_PATTERN.test(code)) &&
    nominal !== null &&
    region !== null &&
    (regionCode === '' || REGION_CODE_PATTERN.test(regionCode))
  return isValid ? { brand, nominal, region, regionCode: regionCode.toUpperCase(), codes: [...codes] } : null
}

/**
 * Ссылка на подарок: текущая страница (с её параметрами, например ?demo=1) и подарок после «#».
 * @param {Gift} gift
 * @param {string} pageUrl адрес текущей страницы
 */
export const giftLink = (gift, pageUrl) => {
  const url = new URL(pageUrl)
  url.searchParams.delete(BUILD_PARAM)
  const payload = { b: gift.brand, n: gift.nominal, r: gift.region, rc: gift.regionCode, c: gift.codes }
  url.hash = `${GIFT_PARAM}=${toBase64Url(JSON.stringify(payload))}`
  return url.toString()
}

/** Подарок из части адреса после «#» или null, если ссылки на подарок нет или она испорчена. */
export const readGiftLink = (hash) => {
  const match = String(hash ?? '').match(new RegExp(`^#?${GIFT_PARAM}=([A-Za-z0-9_-]{1,2000})$`))
  if (!match) return null
  try {
    return validGift(JSON.parse(fromBase64Url(match[1])))
  } catch {
    return null
  }
}
