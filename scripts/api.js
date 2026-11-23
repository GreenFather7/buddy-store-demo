import { CONFIG } from './config.js?v=1795434061'
import { mockRequest } from './mock.js?v=1795434061'

const SESSION_HEADER = 'x-guest-session'
const SESSION_PATH = '/api/web/session'
const SESSION_KEY_PREFIX = 'buddy.session.'
const SESSION_REFRESH_MARGIN_MS = 60 * 60 * 1000
const HTTP_UNAUTHORIZED = 401

const BASE_URL = { stars: CONFIG.starsApi, cards: CONFIG.cardsApi }

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
  }
}

const readSession = (shop) => {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY_PREFIX + shop) ?? 'null')
    return session && session.expiresAt - SESSION_REFRESH_MARGIN_MS > Date.now() ? session : null
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

const memorySessions = {}

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

const openSession = async (shop) => {
  const cached = memorySessions[shop] ?? readSession(shop)
  if (cached) return cached
  const { token, expires_in: expiresIn } = await send(shop, SESSION_PATH, { method: 'POST' })
  const session = { token, expiresAt: Date.now() + expiresIn * 1000 }
  memorySessions[shop] = session
  writeSession(shop, session)
  return session
}

const dropSession = (shop) => {
  delete memorySessions[shop]
  writeSession(shop, null)
}

/**
 * Запрос к бэкенду магазина от имени гостя.
 * @param {'stars'|'cards'} shop
 * @param {string} path
 * @param {{method?: string, query?: Record<string, string|number>, body?: object, headers?: Record<string, string>, isPublic?: boolean}} [options]
 */
export const request = async (shop, path, { isPublic = false, ...options } = {}) => {
  if (isPublic) return send(shop, path, options)
  const session = await openSession(shop)
  try {
    return await send(shop, path, { ...options, token: session.token })
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== HTTP_UNAUTHORIZED) throw error
    // Сессия протухла или секрет сменили — берём новую и повторяем один раз.
    dropSession(shop)
    const fresh = await openSession(shop)
    return send(shop, path, { ...options, token: fresh.token })
  }
}

/** Абсолютный адрес картинки, которую бэкенд отдал путём от корня. */
export const assetUrl = (shop, path) => (CONFIG.demo ? path : new URL(path, BASE_URL[shop]).href)
