// Демо-режим (?demo=1): ответы в форме настоящих API, чтобы смотреть сайт без бэкенда.
// Исход заказа выбирают в окне тестовой оплаты (settleDemoOrder): успех, отказ платежа,
// ошибка выдачи или задержка. В боевом режиме не используется.

import { ApiError } from './api.js'

/** Сколько заказ «отправляется» после оплаты, прежде чем показать итог. */
const DELIVERY_MS = 1800
const HTTP_NOT_FOUND = 404
const HTTP_CONFLICT = 409
/** Тестовые ники и логины, на которых сервер отвечает ошибкой — чтобы проверить экраны ошибок. */
const MISSING_ACCOUNT = 'nouser'
const HAS_PREMIUM = 'hasprem'
const NETWORK_DELAY_MS = 250
const RUB_PER_STAR = 1.75
const RUB_PER_USDT = 90
const RUB_PER_TON = 250

const orders = new Map()
let nextOrderId = 1000000001

const money = (rub) => ({
  total_rub: String(Math.ceil(rub)),
  total_usdt: (rub / RUB_PER_USDT).toFixed(2),
  total_ton: (rub / RUB_PER_TON).toFixed(4),
})

const createOrder = (extra = {}) => {
  const id = nextOrderId++
  orders.set(String(id), { createdAt: Date.now(), ...extra })
  return id
}

/** @typedef {'success'|'declined'|'failed'|'delayed'} DemoOutcome */

/** Исход выбран в окне тестовой оплаты. До этого заказ ждёт оплату. */
export const settleDemoOrder = (orderId, outcome) => {
  const key = String(orderId)
  const order = orders.get(key)
  if (order) orders.set(key, { ...order, outcome, settledAt: Date.now() })
}

/** Что сейчас с заказом: 'pending' | 'paid' | итог. */
const phase = (orderId) => {
  const order = orders.get(String(orderId))
  if (!order?.outcome) return 'pending'
  if (order.outcome === 'declined') return 'declined'
  if (order.outcome === 'delayed') return 'delayed'
  return Date.now() - order.settledAt < DELIVERY_MS ? 'paid' : order.outcome
}

const rejectAccount = (name, status = HTTP_NOT_FOUND) => {
  if (String(name ?? '').toLowerCase() === (status === HTTP_CONFLICT ? HAS_PREMIUM : MISSING_ACCOUNT)) {
    throw new ApiError(status, 'demo')
  }
}

const starsInvoice = ({ body }) => {
  rejectAccount(body.recipient_username)
  const orderId = createOrder()
  return {
    payments: [
      { provider: 'lava', url: 'https://example.com/pay-sbp', order_id: orderId },
      { provider: 'cryptobot', url: 'https://t.me/CryptoBot', order_id: orderId },
    ],
  }
}

const tonIntent = (prefix, rub) => {
  const orderId = createOrder()
  return {
    memo: `${prefix}_${orderId}_demo`,
    amount_ton: (rub / RUB_PER_TON).toFixed(4),
    wallet_address: 'UQDemoWalletAddress000000000000000000000000000000',
    order_id: orderId,
  }
}

// Номера — как у анимаций подарков в assets/gifts (по названиям слоёв в файлах мини-приложения),
// чтобы в тестовом режиме эмодзи на кнопке совпадал с анимацией в строке ввода.
const GIFTS = [
  [10, '🧸', 15],
  [9, '💝', 15],
  [11, '🎁', 25],
  [12, '🌹', 25],
  [13, '🎂', 50],
  [15, '🚀', 50],
  [16, '🏆', 100],
  [18, '💎', 100],
].map(([id, emoji, stars]) => ({ id, emoji, price_stars: stars, ...money(stars * 2.1) }))

const CATALOG = [
  ['ps', 'PlayStation'],
  ['app', 'App Store'],
  ['xbox', 'Xbox'],
  ['roblox', 'Roblox'],
  ['nintendo', 'Nintendo'],
  ['gplay', 'Google Play'],
  ['netflix', 'Netflix'],
  ['spotify', 'Spotify'],
].map(([id, name], index) => ({
  id,
  name,
  flow: 'voucher',
  voucher_type: id,
  image_url: '',
  is_available: id !== 'spotify',
  sort: index,
}))

const ROUTES = {
  'stars POST /api/web/session': () => ({ token: 'demo', expires_in: 86400 }),
  'cards POST /api/web/session': () => ({ token: 'demo', expires_in: 86400 }),

  'stars GET /api/star_price': ({ query }) => ({ stars_amount: query.stars, ...money(query.stars * RUB_PER_STAR) }),
  'stars POST /api/create_invoice': starsInvoice,
  'stars POST /api/ton_intent': ({ body }) => tonIntent('stars', body.stars_amount * RUB_PER_STAR),

  'stars GET /api/premium/price': () => ({
    prices: Object.fromEntries(
      [
        [3, 1290],
        [6, 1790],
        [12, 2990],
      ].map(([months, rub]) => {
        const price = money(rub)
        return [String(months), { rub: price.total_rub, usdt: price.total_usdt, ton: price.total_ton }]
      }),
    ),
  }),
  'stars POST /api/premium/create_invoice': (request) => {
    rejectAccount(request.body.recipient_username, HTTP_CONFLICT)
    return starsInvoice(request)
  },
  'stars POST /api/premium/ton_intent': () => tonIntent('prem', 1290),

  'stars GET /api/topup/price': ({ query }) => money(query.amount_ton * RUB_PER_TON * 1.18),
  'stars POST /api/topup/create_invoice': starsInvoice,
  'stars POST /api/topup/ton_intent': ({ body }) => tonIntent('topup', body.amount_ton * RUB_PER_TON),

  'stars GET /api/gifts/list': () => ({ items: GIFTS }),
  'stars POST /api/gifts/create_invoice': starsInvoice,
  'stars POST /api/gifts/ton_intent': () => tonIntent('gift', 60),

  'stars POST /api/ton_verify': ({ body }) => {
    const orderId = body.memo.split('_')[1]
    return { status: phase(orderId) === 'pending' ? 'pending' : 'completed' }
  },
  'stars GET /api/check_payment': ({ query }) => {
    const STARS_STATUS = { pending: 'pending', paid: 'paid', delayed: 'paid', success: 'stars_sent' }
    return { status: STARS_STATUS[phase(query.order_id)] ?? phase(query.order_id) }
  },

  'cards GET /api/catalog': () => ({ items: CATALOG }),
  'cards GET /api/steam/price': ({ query }) => rejectAccount(query.account) ?? ({
    account: query.account,
    net_amount: Number(query.amount),
    user_price: Math.ceil(query.amount * 1.07),
    user_price_usdt: ((query.amount * 1.07) / RUB_PER_USDT).toFixed(2),
  }),
  'cards GET /api/vouchers/services': () => ({
    items: [
      ['tr', 'Турция'],
      ['us', 'США'],
      ['in', 'Индия'],
      ['ae', 'ОАЭ'],
      ['kz', 'Казахстан'],
      ['de', 'Германия'],
      ['br', 'Бразилия'],
      ['pl', 'Польша'],
      ['gb', 'Великобритания'],
      ['jp', 'Япония'],
    ].map(([id, name]) => ({ id, region_code: id.toUpperCase(), region_name: name, is_available: true })),
  }),
  'cards GET /api/vouchers/list': ({ query }) => ({
    vouchers: [10, 25, 50, 100].map((amount, index) => ({
      id: String(index),
      name: `${amount} ${query.service_id.toUpperCase()}`,
      short_name: `${amount} $`,
      user_price: amount * 99,
      in_stock: true,
    })),
  }),
  'cards POST /api/steam/create_order': ({ body }) => {
    rejectAccount(body.account)
    return cardsOrder(false)
  },
  'cards POST /api/vouchers/create_order': () => cardsOrder(true),
  'cards GET /api/check_order': ({ query }) => {
    const order = orders.get(query.order_id)
    const CARDS_STATUS = { pending: 'Pending', paid: 'Paid', delayed: 'Stuck', success: 'Success', declined: 'Declined', failed: 'Fail' }
    const status = CARDS_STATUS[phase(query.order_id)]
    const hasCode = order?.hasCode !== false
    return {
      status,
      product_type: hasCode ? 'playstation' : 'steam',
      codes: status === 'Success' && hasCode ? ['DEMO-7K2P-9QXA-44MT'] : [],
    }
  },
}

function cardsOrder(hasCode) {
  const orderId = `demo-${createOrder()}`
  orders.set(orderId, { createdAt: Date.now(), hasCode })
  return {
    order_id: orderId,
    payment_link_rub: 'https://example.com/pay-sbp',
    payment_link_usdt: 'https://t.me/CryptoBot',
  }
}

export const mockRequest = async (shop, path, { method, query = {}, body = {} }) => {
  await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS))
  const handler = ROUTES[`${shop} ${method} ${path}`]
  if (!handler) throw new Error(`demo: нет ответа для ${shop} ${method} ${path}`)
  return handler({ query, body })
}
