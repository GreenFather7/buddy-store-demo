import { ApiError, request } from './api.js'
import { BRANDS } from './brands.js'
import {
  ORDER_STATE,
  flagUrl,
  formatRub,
  isValidSteamLogin,
  isValidUsername,
  mapCardsStatus,
  mapStarsStatus,
  normalizeUsername,
  parseIntInRange,
  trimDecimals,
} from './lib.js'

const STARS_MIN = 50
const STARS_MAX = 5000
const GRAM_MIN = 1
const GRAM_MAX = 100
const STEAM_MIN = 100
const STEAM_MAX = 5000
const PREMIUM_MONTHS = [3, 6, 12]
const PREMIUM_LABEL = { 3: '3 месяца', 6: '6 месяцев', 12: '1 год' }
const HTTP_UNAVAILABLE = 503

// Кнопки быстрого выбора — те же значения и те же иконки, что в мини-приложении Stars
// (STAR_PRESETS и TON_PRESETS): чем больше сумма, тем выше стопка.
const withIcons = (name, values) =>
  values.map((value, index) => ({ value, icon: `assets/presets/${name}-${index + 2}.${name === 'stars' ? 'webp' : 'svg'}` }))

const STARS_PRESETS = withIcons('stars', [50, 200, 500, 1000])
const GRAM_PRESETS = withIcons('gram', [10, 30, 50, 100])
const STEAM_PRESETS = [100, 500, 1000, 5000].map((value) => ({ value }))

const recipientField = {
  key: 'recipient',
  type: 'text',
  label: 'Кому',
  prefix: '@',
  placeholder: 'username',
  autocomplete: 'username',
  validate: (value) => (isValidUsername(value) ? null : 'Введите username из Telegram'),
}

const prices = ({ rub, ton, usdt }) => ({
  sbp: rub ? formatRub(rub) : null,
  ton: ton ? `${trimDecimals(ton)} TON` : null,
  usdt: usdt ? `${trimDecimals(usdt)} USDT` : null,
})

// ── Stars-бэкенд: у всех четырёх товаров одна схема оплаты ──────────
const starsCheckout = ({ invoicePath, intentPath, body }) => ({
  methods: ['sbp', 'ton', 'usdt'],

  async order(values, method) {
    const payload = body(values)
    if (method === 'ton') {
      const intent = await request('stars', intentPath, { method: 'POST', body: payload })
      return {
        kind: 'ton',
        ton: { address: intent.wallet_address, amountTon: intent.amount_ton, memo: intent.memo },
        ref: { shop: 'stars', orderId: intent.order_id, memo: intent.memo },
      }
    }
    const { payments } = await request('stars', invoicePath, { method: 'POST', body: payload })
    const provider = method === 'usdt' ? 'cryptobot' : 'lava'
    const option = payments.find((payment) => payment.provider === provider)
    if (!option) throw new ApiError(HTTP_UNAVAILABLE, 'payment method unavailable')
    return {
      kind: method === 'usdt' ? 'link' : 'redirect',
      url: option.url,
      ref: { shop: 'stars', orderId: option.order_id },
    }
  },
})

export const checkStarsOrder = async ({ orderId, memo }) => {
  if (memo) {
    // TON: сначала сервер должен увидеть перевод с нашим комментарием.
    const { status } = await request('stars', '/api/ton_verify', { method: 'POST', body: { memo } })
    if (status === 'pending') return { state: ORDER_STATE.PENDING }
  }
  const { status } = await request('stars', '/api/check_payment', { query: { order_id: orderId } })
  return { state: mapStarsStatus(status) }
}

export const checkCardsOrder = async ({ orderId }) => {
  const order = await request('cards', '/api/check_order', { query: { order_id: orderId } })
  const codes = order.codes ?? []
  const state = mapCardsStatus(order.status)
  // «Готово» без кода у ваучера значит, что код ещё не записан: ждём, а не показываем пустоту.
  const isCodeMissing = state === ORDER_STATE.DONE && order.product_type !== 'steam' && codes.length === 0
  return { state: isCodeMissing ? ORDER_STATE.DELAYED : state, codes }
}

const stars = {
  id: 'stars',
  doneText: 'Звёзды отправлены',
  fields: [
    recipientField,
    {
      key: 'amount',
      type: 'number',
      label: 'Сколько звёзд',
      unitIcon: 'assets/presets/stars-1.svg',
      placeholder: `${STARS_MIN}–${STARS_MAX}`,
      presets: STARS_PRESETS,
      parse: (value) => parseIntInRange(value, STARS_MIN, STARS_MAX),
      error: `От ${STARS_MIN} до ${STARS_MAX}`,
    },
  ],
  async quote({ amount }) {
    const price = await request('stars', '/api/star_price', { query: { stars: amount } })
    return prices({ rub: price.total_rub, ton: price.total_ton, usdt: price.total_usdt })
  },
  ...starsCheckout({
    invoicePath: '/api/create_invoice',
    intentPath: '/api/ton_intent',
    body: ({ recipient, amount }) => ({ recipient_username: recipient, stars_amount: amount }),
  }),
}

const premium = {
  id: 'premium',
  doneText: 'Premium подключён',
  fields: [
    recipientField,
    {
      key: 'months',
      type: 'choice',
      variant: 'preset',
      label: 'Срок',
      // Подарочные коробки Telegram Premium: зелёная — 3 месяца, синяя — 6, красная — год.
      options: async () =>
        PREMIUM_MONTHS.map((months) => ({
          value: months,
          label: PREMIUM_LABEL[months],
          icon: `assets/premium/${months}m.svg`,
        })),
    },
  ],
  async quote({ recipient, months }) {
    const { prices: byMonths } = await request('stars', '/api/premium/price', {
      query: { months, recipient },
    })
    const price = byMonths[String(months)] ?? {}
    // Бэкенд отдаёт «0», если Fragment не дал цену на этот срок.
    if (!Number(price.rub)) throw new ApiError(HTTP_UNAVAILABLE, 'no quote')
    return prices(price)
  },
  ...starsCheckout({
    invoicePath: '/api/premium/create_invoice',
    intentPath: '/api/premium/ton_intent',
    body: ({ recipient, months }) => ({ recipient_username: recipient, months }),
  }),
}

const gram = {
  id: 'gram',
  doneText: 'Gram отправлен',
  fields: [
    recipientField,
    {
      key: 'amount',
      type: 'number',
      label: 'Сколько Gram',
      unitIcon: 'assets/presets/gram-1.svg',
      placeholder: `${GRAM_MIN}–${GRAM_MAX}`,
      presets: GRAM_PRESETS,
      parse: (value) => parseIntInRange(value, GRAM_MIN, GRAM_MAX),
      error: `От ${GRAM_MIN} до ${GRAM_MAX}`,
    },
  ],
  async quote({ recipient, amount }) {
    const price = await request('stars', '/api/topup/price', {
      query: { amount_ton: amount, recipient_username: recipient },
    })
    return prices({ rub: price.total_rub, ton: price.total_ton, usdt: price.total_usdt })
  },
  ...starsCheckout({
    invoicePath: '/api/topup/create_invoice',
    intentPath: '/api/topup/ton_intent',
    body: ({ recipient, amount }) => ({ recipient_username: recipient, amount_ton: amount }),
  }),
}

const gifts = {
  id: 'gifts',
  doneText: 'Подарок отправлен',
  fields: [
    recipientField,
    {
      key: 'gift',
      type: 'choice',
      label: 'Подарок',
      variant: 'media',
      options: async () => {
        const { items } = await request('stars', '/api/gifts/list')
        return items.map((item) => ({
          value: item.id,
          label: item.emoji,
          data: item,
        }))
      },
    },
  ],
  // Цены уже пришли в списке подарков — отдельный запрос не нужен.
  quote: async (_values, options) => {
    const item = options.gift
    return prices({ rub: item.total_rub, ton: item.total_ton, usdt: item.total_usdt })
  },
  ...starsCheckout({
    invoicePath: '/api/gifts/create_invoice',
    intentPath: '/api/gifts/ton_intent',
    body: ({ recipient, gift }) => ({ recipient_username: recipient, gift_id: gift }),
  }),
}

// ── Бэкенд гифт-карт ────────────────────────────────────────────────
const cardsOrder = (path, body) =>
  async function order(values, method) {
    const created = await request('cards', path, { method: 'POST', body: body(values) })
    const url = method === 'usdt' ? created.payment_link_usdt : created.payment_link_rub
    if (!url) throw new ApiError(HTTP_UNAVAILABLE, 'payment method unavailable')
    return {
      kind: method === 'usdt' ? 'link' : 'redirect',
      url,
      ref: { shop: 'cards', orderId: created.order_id },
    }
  }

const steam = {
  id: 'steam',
  doneText: 'Steam пополнен',
  methods: ['sbp', 'usdt'],
  fields: [
    {
      key: 'account',
      type: 'text',
      label: 'Логин Steam',
      placeholder: 'логин, не никнейм',
      autocomplete: 'off',
      validate: (value) => (isValidSteamLogin(value) ? null : 'Латиница, цифры и «_», от 3 символов'),
    },
    {
      key: 'amount',
      type: 'number',
      label: 'Сумма пополнения',
      suffix: '₽',
      placeholder: `${STEAM_MIN}–${STEAM_MAX}`,
      presets: STEAM_PRESETS,
      parse: (value) => parseIntInRange(value, STEAM_MIN, STEAM_MAX),
      error: `От ${STEAM_MIN} до ${STEAM_MAX} ₽`,
    },
  ],
  async quote({ account, amount }) {
    const price = await request('cards', '/api/steam/price', { query: { account, amount } })
    return prices({ rub: price.user_price, usdt: price.user_price_usdt })
  },
  order: cardsOrder('/api/steam/create_order', ({ account, amount }) => ({ account, amount })),
}

/** Сервисы гифт-карт из каталога — по капсуле на каждый в строке разделов. */
export const loadCardServices = async () => {
  const { items } = await request('cards', '/api/catalog', { isPublic: true })
  return items
    .filter((item) => item.flow === 'voucher')
    .map((item) => ({
      id: item.voucher_type,
      label: BRANDS[item.voucher_type]?.label ?? item.name,
      brand: BRANDS[item.voucher_type],
      isAvailable: Boolean(item.is_available),
    }))
}

const cards = {
  id: 'cards',
  doneText: 'Ваш код',
  methods: ['sbp', 'usdt'],
  fields: [
    // Сервис выбирается капсулой в строке разделов, поэтому в форме его нет.
    { key: 'service', type: 'choice', label: 'Сервис', isHidden: true },
    {
      key: 'region',
      type: 'choice',
      variant: 'region',
      label: 'Регион',
      dependsOn: ['service'],
      options: async ({ service }) => {
        const { items } = await request('cards', '/api/vouchers/services', { query: { type: service } })
        return items
          .filter((item) => item.is_available)
          .map((item) => ({
            value: item.id,
            label: item.region_name,
            flag: flagUrl(item.region_code),
            data: { label: item.region_name, code: item.region_code },
          }))
      },
    },
    {
      key: 'voucher',
      type: 'choice',
      label: 'Номинал',
      dependsOn: ['service', 'region'],
      options: async ({ service, region }) => {
        const { vouchers } = await request('cards', '/api/vouchers/list', {
          query: { type: service, service_id: region },
        })
        return vouchers.map((voucher) => ({
          value: voucher.id,
          label: voucher.short_name || voucher.name,
          sub: formatRub(voucher.user_price),
          data: voucher,
        }))
      },
    },
  ],
  // Цена в рублях известна из списка номиналов; сумму в USDT бэкенд считает при заказе.
  quote: async (_values, options) => ({
    sbp: formatRub(options.voucher.user_price),
    ton: null,
    usdt: 'по курсу',
  }),
  // Что показать на карте с кодом: заказ уже оплачен, каталог к этому моменту мог измениться.
  summary: (values, options) => ({
    brand: values.service,
    nominal: options.voucher.short_name || options.voucher.name,
    region: options.region?.label ?? '',
    regionCode: options.region?.code ?? '',
  }),
  order: cardsOrder('/api/vouchers/create_order', ({ service, region, voucher }) => ({
    type: service,
    service_id: region,
    voucher_id: voucher,
  })),
}

export const PRODUCTS = Object.freeze({ stars, premium, gram, gifts, steam, cards })

export const checkOrder = (ref) => (ref.shop === 'cards' ? checkCardsOrder(ref) : checkStarsOrder(ref))

/** Значение поля в том виде, в котором его ждёт бэкенд. */
export const normalizeValue = (field, raw) => {
  if (field.key === 'recipient') return normalizeUsername(raw)
  if (field.type === 'number') return field.parse(raw)
  return typeof raw === 'string' ? raw.trim() : raw
}
