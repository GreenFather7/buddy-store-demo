// Демо-режим (?demo=1): ответы в форме настоящих API, чтобы смотреть сайт без бэкенда.
// Исход заказа выбирают в окне тестовой оплаты (settleDemoOrder): успех, отказ платежа,
// ошибка выдачи или задержка. В боевом режиме не используется.

import { ApiError } from './api.js?v=1795436371'

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
const IS_DEMO_SUBSCRIBER = new URLSearchParams(window.location.search).has('sub')
const SUBSCRIBER_PRICE = 0.9

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

  // ?demo=1&sub=1 — как будто покупатель подписан на канал: цена на 10% ниже
  'stars GET /api/star_price': ({ query }) => ({
    stars_amount: query.stars,
    ...money(query.stars * RUB_PER_STAR * (IS_DEMO_SUBSCRIBER ? SUBSCRIBER_PRICE : 1)),
    is_subscriber: IS_DEMO_SUBSCRIBER,
  }),
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
  'cards GET /api/vouchers/list': ({ query }) => {
    const region = REGION_NOMINALS[query.service_id] ?? REGION_NOMINALS.us
    return {
      vouchers: region.values.map((amount, index) => ({
        id: String(index),
        name: `${query.type} ${region.format(amount)}`,
        short_name: region.format(amount),
        user_price: Math.ceil((amount * region.rub * VOUCHER_MARKUP) / 10) * 10,
        in_stock: true,
      })),
    }
  },
  'cards GET /api/gta/offers': ({ query }) => ({ regions: GTA_OFFERS[query.platform] ?? [] }),
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

// Номиналы в валюте страны — какие продают поставщики (Fazer, Bitrefill) в этих регионах.
// В боевом режиме список приходит от поставщика через /api/vouchers/list, здесь — для вида.
const VOUCHER_MARKUP = 1.08
const spaced = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
const REGION_NOMINALS = {
  tr: { values: [25, 50, 100, 150, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500], rub: 2.8, format: (v) => `${spaced(v)} TL` },
  us: { values: [10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 150, 200, 250, 300, 500], rub: 95, format: (v) => `$${v}` },
  in: { values: [100, 200, 300, 500, 1000, 1500, 2000, 3000, 4000, 5000], rub: 1.15, format: (v) => `₹${spaced(v)}` },
  ae: { values: [20, 50, 100, 150, 200, 250, 300, 500], rub: 26, format: (v) => `${v} AED` },
  kz: { values: [1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 30000], rub: 0.19, format: (v) => `${spaced(v)} ₸` },
  de: { values: [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 150, 200], rub: 102, format: (v) => `${v} €` },
  br: { values: [20, 30, 40, 50, 60, 100, 150, 200, 250, 300], rub: 17, format: (v) => `R$ ${v}` },
  pl: { values: [20, 30, 50, 70, 100, 150, 200, 250, 300, 500], rub: 24, format: (v) => `${v} zł` },
  gb: { values: [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 150], rub: 120, format: (v) => `£${v}` },
  jp: { values: [1000, 1500, 3000, 5000, 10000, 15000, 20000], rub: 0.62, format: (v) => `¥${spaced(v)}` },
}

// GTA VI: страны, где карта есть хотя бы на одно издание, и для каждого издания — цена игры
// в магазине и карта, которой на неё хватает. Цены игры — для вида, настоящие берёт бэкенд бота.
const gtaRegion = (id, name, editions) => ({
  service_id: `gta-${id}`,
  region_code: id.toUpperCase(),
  region_name: name,
  editions: editions.map(([edition, label, gamePrice, card, rub]) => ({
    edition,
    label,
    game_price: gamePrice,
    voucher: { id: `${id}-${edition}`, short_name: card, user_price: rub },
  })),
})
const GTA_OFFERS = {
  ps: [
    gtaRegion('tr', 'Турция', [
      ['standard', 'Standard', '3 999 TL', '4 000 TL', 8960],
      ['ultimate', 'Ultimate', '4 999 TL', '5 000 TL', 11200],
    ]),
    gtaRegion('us', 'США', [
      ['standard', 'Standard', '$69.99', '$75', 7700],
      ['ultimate', 'Ultimate', '$99.99', '$100', 10260],
    ]),
    gtaRegion('in', 'Индия', [
      ['standard', 'Standard', '₹4 999', '₹5 000', 6210],
      ['ultimate', 'Ultimate', '₹6 999', '₹7 000', 8690],
    ]),
    gtaRegion('pl', 'Польша', [['standard', 'Standard', '349 zł', '350 zł', 9080]]),
  ],
  xbox: [
    gtaRegion('us', 'США', [
      ['standard', 'Standard', '$69.99', '$75', 7700],
      ['ultimate', 'Ultimate', '$99.99', '$100', 10260],
    ]),
    gtaRegion('br', 'Бразилия', [
      ['standard', 'Standard', 'R$ 349', 'R$ 350', 6430],
      ['ultimate', 'Ultimate', 'R$ 499', 'R$ 500', 9180],
    ]),
    gtaRegion('tr', 'Турция', [['standard', 'Standard', '3 999 TL', '4 000 TL', 8960]]),
  ],
}

export const mockRequest = async (shop, path, { method, query = {}, body = {} }) => {
  await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS))
  const handler = ROUTES[`${shop} ${method} ${path}`]
  if (!handler) throw new Error(`demo: нет ответа для ${shop} ${method} ${path}`)
  return handler({ query, body })
}
