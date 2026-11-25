import { CONFIG } from './config.js?v=1795612634'
import { mockRequest } from './mock.js?v=1795612634'

const SESSION_HEADER = 'x-guest-session'
const TELEGRAM_HEADER = 'x-telegram-init-data'
const SESSION_PATH = '/api/web/session'
const SESSION_KEY_PREFIX = 'buddy.session.'
const SESSION_REFRESH_MARGIN_MS = 60 * 60 * 1000
const HTTP_UNAUTHORIZED = 401
/** Событие для main.js: вход Telegram устарел, покупателю нужно открыть магазин заново. */
export const RELAUNCH_EVENT = 'buddy:relaunch'

const BASE_URL = { stars: CONFIG.starsApi, cards: CONFIG.cardsApi }

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Подпись Telegram (initData) для этого бэкенда или null — тогда ходим гостем.
 * Бэкенд проверяет её токеном своего бота, поэтому включается в config.js только для бэкенда того бота,
 * из которого открыто мини-приложение (telegramAuth).
 */
const telegramInitData = (shop) => {
  const initData = window.Telegram?.WebApp?.initData
  return CONFIG.telegramAuth[shop] && typeof initData === 'string' && initData ? initData : null
}

const readSession = (shop) => {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY_PREFIX + shop) ?? 'null')
    return session && typeof session.token === 'string' && Number.isFinite(session.expiresAt) ? session : null
  } catch {
    return null // хранилище недоступно или повреждено — запросим новую сессию
  }
}

const writeSession = (shop, session) => {
  try {
    if (session) localStorage.setItem(SESSION_KEY_PREFIX + shop, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY_PREFIX + shop)
  } catch {
    // приватный режим: сессия проживёт до закрытия вкладки в памяти
  }
}

const isFresh = (session) => Boolean(session) && session.expiresAt - SESSION_REFRESH_MARGIN_MS > Date.now()

const memorySessions = {}
/** Запрос сессии, который уже идёт: параллельные запросы ждут его, а не получают каждый свой id. */
const pendingSessions = {}

const send = async (shop, path, { method = 'GET', query, body, token, headers } = {}) => {
  if (CONFIG.demo) return mockRequest(shop, path, { method, query, body })
  if (!BASE_URL[shop]) throw new ApiError(503, 'API address is not configured')

  const url = new URL(BASE_URL[shop] + path)
  Object.entries(query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))

  let response
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { [SESSION_HEADER]: token } : {}),
        ...(headers ?? {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'network')
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new ApiError(response.status, payload?.detail)
  }
  return response.json()
}

/**
 * Гостевая сессия. Старый токен (даже истёкший) отправляется с запросом новой: бэкенд выдаёт
 * токен на тот же id, и гость не теряет доступ к своим оплаченным заказам.
 */
const openSession = (shop) => {
  const known = memorySessions[shop] ?? readSession(shop)
  if (isFresh(known)) return Promise.resolve(known)
  pendingSessions[shop] ??= send(shop, SESSION_PATH, { method: 'POST', token: known?.token })
    .then(({ token, expires_in: expiresIn }) => {
      const session = { token, expiresAt: Date.now() + expiresIn * 1000 }
      memorySessions[shop] = session
      writeSession(shop, session)
      return session
    })
    .finally(() => {
      delete pendingSessions[shop]
    })
  return pendingSessions[shop]
}

/** Сессию отклонили (сменили секрет): забываем и берём новую — старый id уже не вернуть. */
const dropSession = (shop) => {
  delete memorySessions[shop]
  writeSession(shop, null)
}

/** Ошибка «вход Telegram устарел»: повторять запросы бессмысленно (status.js по ней прекращает опрос). */
export class RelaunchError extends ApiError {
  constructor() {
    super(HTTP_UNAUTHORIZED, 'telegram session expired')
    this.name = 'RelaunchError'
  }
}

const relaunchNeeded = () => {
  window.dispatchEvent(new CustomEvent(RELAUNCH_EVENT))
  return new RelaunchError()
}

/**
 * Запрос к бэкенду магазина: в Telegram — от имени пользователя Telegram, на сайте — гостем.
 * @param {'stars'|'cards'} shop
 * @param {string} path
 * @param {{method?: string, query?: Record<string, string|number>, body?: object, headers?: Record<string, string>, isPublic?: boolean}} [options]
 */
export const request = async (shop, path, { isPublic = false, ...options } = {}) => {
  if (isPublic) return send(shop, path, options)
  const initData = telegramInitData(shop)
  if (initData) {
    try {
      return await send(shop, path, { ...options, headers: { ...options.headers, [TELEGRAM_HEADER]: initData } })
    } catch (error) {
      // подпись Telegram устарела — заново её выдаст только новый запуск мини-приложения
      if (error instanceof ApiError && error.status === HTTP_UNAUTHORIZED) throw relaunchNeeded()
      throw error
    }
  }
  const session = await openSession(shop)
  try {
    return await send(shop, path, { ...options, token: session.token })
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== HTTP_UNAUTHORIZED) throw error
    // Сессия протухла или секрет сменили — продлеваем (тот же id, если бэкенд узнал токен) и повторяем один раз.
    if (memorySessions[shop] === session) {
      delete memorySessions[shop]
      writeSession(shop, { ...session, expiresAt: 0 })
    }
    const fresh = await openSession(shop).catch((sessionError) => {
      dropSession(shop)
      throw sessionError
    })
    return send(shop, path, { ...options, token: fresh.token })
  }
}

/** Абсолютный адрес картинки, которую бэкенд отдал путём от корня. */
export const assetUrl = (shop, path) => (CONFIG.demo ? path : new URL(path, BASE_URL[shop]).href)
