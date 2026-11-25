// Ссылка на подаренную гифт-карту: сервис, номинал, регион и код лежат в части адреса после «#».
// Эта часть не уходит на сервер (ни в запросы, ни в логи хостинга) — её видит только тот,
// кому покупатель отправил ссылку. По ней открывается карта с кнопкой «Скопировать код».
//
// Боевая ссылка подписана бэкендом (ECDSA P-256, данные и подпись — из /api/check_order): иначе
// любой собрал бы на домене магазина «карту» с выдуманным кодом. Получатель видит только
// подписанные данные; без верной подписи ссылка не открывается (verifyGiftLink).

import { BRANDS } from './brands.js?v=1795612634'

const GIFT_PARAM = 'gift'
const MAX_CODES = 5
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{2,62}[A-Za-z0-9]$/
const REGION_CODE_PATTERN = /^[A-Za-z]{2}$/
const MAX_TEXT = 40
const SIGNATURE_LENGTH = 86 // 64 байта подписи P-256 в base64url
const LINK_PATTERN = new RegExp(`^#?${GIFT_PARAM}=([A-Za-z0-9_-]{1,2000})(?:\\.([A-Za-z0-9_-]{${SIGNATURE_LENGTH}}))?$`)
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

const bytesFromBase64 = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))

const fromBase64Url = (value) => new TextDecoder().decode(bytesFromBase64(value))

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
 * С подписью бэкенда в ссылку кладутся ровно подписанные данные, без неё — данные карты (только демо).
 * @param {Gift} gift
 * @param {string} pageUrl адрес текущей страницы
 * @param {{data: string, sig: string}|null} [signed] подписанные данные из /api/check_order
 */
export const giftLink = (gift, pageUrl, signed = null) => {
  const url = new URL(pageUrl)
  url.searchParams.delete(BUILD_PARAM)
  const payload = { b: gift.brand, n: gift.nominal, r: gift.region, rc: gift.regionCode, c: gift.codes }
  url.hash = signed ? `${GIFT_PARAM}=${signed.data}.${signed.sig}` : `${GIFT_PARAM}=${toBase64Url(JSON.stringify(payload))}`
  return url.toString()
}

/** Разбор ссылки: подарок и, если есть, подпись. null — ссылки нет или она испорчена. */
export const parseGiftLink = (hash) => {
  const match = String(hash ?? '').match(LINK_PATTERN)
  if (!match) return null
  try {
    const gift = validGift(JSON.parse(fromBase64Url(match[1])))
    return gift ? { gift, data: match[1], sig: match[2] ?? null } : null
  } catch {
    return null
  }
}

/** Подарок из части адреса после «#» без проверки подписи (демо и тесты). */
export const readGiftLink = (hash) => parseGiftLink(hash)?.gift ?? null

/**
 * Подарок из ссылки, если ей можно верить: подпись бэкенда сходится с открытым ключом.
 * @param {string} hash часть адреса после «#»
 * @param {{ publicKey: string, requireSigned: boolean }} options publicKey — SPKI в base64;
 *   requireSigned=false (демо) пускает и неподписанные ссылки
 * @returns {Promise<Gift|null>}
 */
export const verifyGiftLink = async (hash, { publicKey, requireSigned }) => {
  const parsed = parseGiftLink(hash)
  if (!parsed) return null
  if (!parsed.sig) return requireSigned ? null : parsed.gift
  if (!publicKey || !globalThis.crypto?.subtle) return null
  try {
    const algorithm = { name: 'ECDSA', namedCurve: 'P-256' }
    const key = await crypto.subtle.importKey('spki', bytesFromBase64(publicKey), algorithm, false, ['verify'])
    const isValid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytesFromBase64(parsed.sig), bytesFromBase64(parsed.data))
    return isValid ? parsed.gift : null
  } catch {
    return null // битый ключ или подпись
  }
}
