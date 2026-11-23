import { ApiError, request } from './api.js?v=1795439095'
import { CONFIG } from './config.js?v=1795439095'
import { BRANDS } from './brands.js?v=1795439095'
import {
  ORDER_STATE,
  flagUrl,
  failureReason,
  formatRub,
  groupThousands,
  isValidSteamLogin,
  isValidUsername,
  mapCardsStatus,
  mapStarsStatus,
  normalizeUsername,
  parseIntInRange,
  trimDecimals,
} from './lib.js?v=1795439095'

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

/** Ссылка на канал (в тестовом режиме — заглушка, чтобы было видно строку). */
const channelLink = () => CONFIG.channelUrl || (CONFIG.demo ? 'https://t.me/telegram' : '')

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
  return { state: mapStarsStatus(status), reason: failureReason(status) }
}

export const checkCardsOrder = async ({ orderId }) => {
  const order = await request('cards', '/api/check_order', { query: { order_id: orderId } })
  const codes = order.codes ?? []
  const state = mapCardsStatus(order.status)
  // «Готово» без кода у ваучера значит, что код ещё не записан: ждём, а не показываем пустоту.
  const isCodeMissing = state === ORDER_STATE.DONE && order.product_type !== 'steam' && codes.length === 0
  return { state: isCodeMissing ? ORDER_STATE.DELAYED : state, codes, reason: failureReason(order.status) }
}

const stars = {
  id: 'stars',
  // цена звёзд зависит только от количества — показываем её, не дожидаясь ника
  quoteKeys: ['amount'],
  // amount — для строки о розыгрыше: 1 билет за 50 звёзд
  summary: ({ recipient, amount }) => ({ line: `${groupThousands(amount)} ⭐ для @${recipient}`, amount }),
  doneText: 'Звёзды *отправлены*',
  fields: [
    recipientField,
    {
      key: 'amount',
      type: 'number',
      label: 'Сколько звёзд',
      unitIcon: 'assets/presets/stars-1.svg',
      placeholder: `${groupThousands(STARS_MIN)} – ${groupThousands(STARS_MAX)}`,
      presets: STARS_PRESETS,
      parse: (value) => parseIntInRange(value, STARS_MIN, STARS_MAX),
      error: `От ${groupThousands(STARS_MIN)} до ${groupThousands(STARS_MAX)}`,
    },
  ],
  async quote({ amount }) {
    const price = await request('stars', '/api/star_price', { query: { stars: amount } })
    // подписчикам канала бэкенд считает цену ниже — это видно в строке под кнопкой
    return { ...prices({ rub: price.total_rub, ton: price.total_ton, usdt: price.total_usdt }), isSubscriber: price.is_subscriber === true }
  },
  // «Цена для подписчиков канала» или «Подписчикам канала — дешевле ›» со ссылкой на канал
  payNote: (_values, _options, quote) => {
    if (!quote) return null
    if (quote.isSubscriber) return { text: '🔔 Цена для подписчиков канала' }
    return channelLink() ? { text: '🔔 Подписчикам канала — дешевле ›', link: channelLink() } : null
  },
  ...starsCheckout({
    invoicePath: '/api/create_invoice',
    intentPath: '/api/ton_intent',
    body: ({ recipient, amount }) => ({ recipient_username: recipient, stars_amount: amount }),
  }),
}

const premium = {
  id: 'premium',
  // бэкенд считает цену через Fragment для конкретного получателя — без ника цены нет
  summary: ({ recipient, months }) => ({ line: `Premium на ${PREMIUM_LABEL[months] ?? `${months} мес.`} для @${recipient}` }),
  doneText: 'Premium *подключён*',
  fields: [
    recipientField,
    {
      key: 'months',
      type: 'choice',
      variant: 'preset',
      label: 'Срок',
      // выбранная коробка встаёт справа в строку ввода и проигрывает свою анимацию
      hasPreview: true,
      // Подарочные коробки Telegram Premium: зелёная — 3 месяца, синяя — 6, красная — год.
      // Анимации — из TGS-стикеров бота (assets/premium/<N>m.json), картинки — их кадр.
      options: async () =>
        PREMIUM_MONTHS.map((months) => ({
          value: months,
          label: PREMIUM_LABEL[months],
          icon: `assets/premium/${months}m.svg`,
          preview: {
            key: `premium-${months}`,
            image: `assets/premium/${months}m.svg`,
            animation: `assets/premium/${months}m.json`,
          },
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
  // бэкенд считает цену через Fragment для конкретного получателя — без ника цены нет
  summary: ({ recipient, amount }) => ({ line: `${groupThousands(amount)} 💎 для @${recipient}` }),
  doneText: 'Gram *отправлен*',
  fields: [
    recipientField,
    {
      key: 'amount',
      type: 'number',
      label: 'Сколько Gram',
      unitIcon: 'assets/presets/gram-1.svg',
      placeholder: `${groupThousands(GRAM_MIN)} – ${groupThousands(GRAM_MAX)}`,
      presets: GRAM_PRESETS,
      parse: (value) => parseIntInRange(value, GRAM_MIN, GRAM_MAX),
      error: `От ${groupThousands(GRAM_MIN)} до ${groupThousands(GRAM_MAX)}`,
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
  // цена подарка известна из списка — показываем сразу после выбора
  quoteKeys: ['gift'],
  summary: ({ recipient, gift }, options) => ({ line: `для @${recipient}`, gift: { id: gift, emoji: options.gift?.emoji ?? '🎁' } }),
  doneText: 'Подарок *отправлен*',
  fields: [
    recipientField,
    {
      key: 'gift',
      type: 'choice',
      label: 'Подарок',
      // выбранный подарок показывается справа в строке ввода со своей анимацией
      hasPreview: true,
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
  summary: ({ account, amount }) => ({ line: `${groupThousands(amount)} ₽ на аккаунт ${account}` }),
  doneText: 'Steam *пополнен*',
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
      placeholder: `${groupThousands(STEAM_MIN)} – ${groupThousands(STEAM_MAX)}`,
      presets: STEAM_PRESETS,
      parse: (value) => parseIntInRange(value, STEAM_MIN, STEAM_MAX),
      error: `От ${groupThousands(STEAM_MIN)} до ${groupThousands(STEAM_MAX)} ₽`,
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
  doneText: 'Код *готов*',
  // Пока не всё выбрано, кнопка подсказывает следующий шаг (она остаётся активной: нажатие
  // подсветит нужный ряд красным).
  payHint: (values) => {
    if (values.region === undefined) return 'Выберите страну'
    if (values.voucher === undefined) return 'Выберите номинал'
    return null
  },
  // Под кнопкой «Оплатить» серой строкой — что именно покупается: «🇹🇷 Гифт-карта PlayStation · Турция · 1 500 TL».
  // Больше нигде не сказано, что это гифт-карта (код), а глагол на кнопке у всех разделов один.
  // null — выбор ещё не собран (страна сменилась, номинал не выбран).
  payNote: (values, options) => {
    const brand = BRANDS[values.service]?.label
    const nominal = options.voucher?.short_name || options.voucher?.name
    if (!brand || !nominal) return null
    const region = options.region?.label
    const parts = [`Gift-карта ${brand}`, region, nominal].filter(Boolean)
    return { text: parts.join(' · '), flag: flagUrl(options.region?.code) }
  },
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
      variant: 'nominal',
      dependsOn: ['service', 'region'],
      options: async ({ service, region }) => {
        const { vouchers } = await request('cards', '/api/vouchers/list', {
          query: { type: service, service_id: region },
        })
        return vouchers.map((voucher) => ({
          value: voucher.id,
          // цена номинала — на кнопке «Оплатить» после выбора
          label: voucher.short_name || voucher.name,
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

// ── GTA VI ──────────────────────────────────────────────────────────
// Как форма GTA VI в боте гифт-карт: продаётся карта PlayStation или Xbox страны — самый дешёвый
// номинал, которого хватает на издание игры по цене магазина. Страны и издания с подобранной картой
// отдаёт бэкенд (/api/gta/offers по платформе), покупка — обычный ваучер.
// Два ряда, как у гифт-карт (экран не меняет высоту): страна, затем издание вместе с платформой
// (логотип платформы и «Standard» / «Ultimate») — только те, на которые в этой стране есть карта.
const GTA_PLATFORMS = ['ps', 'xbox']

/** Предложения обеих платформ: [{ platform, regions }]. Платформа без ответа просто пропускается. */
const gtaOffers = async () => {
  const results = await Promise.allSettled(
    GTA_PLATFORMS.map((platform) => request('cards', '/api/gta/offers', { query: { platform } })),
  )
  const offers = results.flatMap((result, index) =>
    result.status === 'fulfilled' ? [{ platform: GTA_PLATFORMS[index], regions: result.value.regions ?? [] }] : [],
  )
  if (offers.length === 0) throw results[0].reason
  return offers
}

const gta = {
  id: 'gta',
  doneText: 'Код *готов*',
  methods: ['sbp', 'usdt'],
  payHint: (values) => {
    if (values.region === undefined) return 'Выберите страну'
    if (values.edition === undefined) return 'Выберите издание'
    return null
  },
  // «🇹🇷 Карта PlayStation 4 000 TL · хватит на Standard» (что это GTA VI — видно по выбранной капсуле)
  payNote: (_values, options) => {
    const edition = options.edition
    if (!edition) return null
    return {
      text: `Карта ${BRANDS[edition.platform].label} ${edition.voucher.short_name} · хватит на ${edition.label}`,
      flag: flagUrl(options.region?.code),
    }
  },
  fields: [
    {
      key: 'region',
      type: 'choice',
      variant: 'region',
      label: 'Регион',
      options: async () => {
        const offers = await gtaOffers()
        const byCode = new Map()
        offers.forEach(({ regions }) =>
          regions.forEach((region) => {
            if (!byCode.has(region.region_code)) byCode.set(region.region_code, region)
          }),
        )
        return [...byCode.values()].map((region) => ({
          value: region.region_code,
          label: region.region_name,
          flag: flagUrl(region.region_code),
          data: { label: region.region_name, code: region.region_code },
        }))
      },
    },
    {
      key: 'edition',
      type: 'choice',
      variant: 'edition',
      label: 'Издание',
      dependsOn: ['region'],
      options: async ({ region }) => {
        const offers = await gtaOffers()
        return offers.flatMap(({ platform, regions }) => {
          const found = regions.find((item) => item.region_code === region)
          return (found?.editions ?? []).map((edition) => ({
            value: `${platform}:${edition.edition}`,
            label: edition.label,
            logo: BRANDS[platform].path,
            // старшее издание выделено золотым — его видно среди остальных
            accent: edition.edition === 'ultimate',
            data: { ...edition, platform, service_id: found.service_id },
          }))
        })
      },
    },
  ],
  quote: async (_values, options) => ({
    sbp: formatRub(options.edition.voucher.user_price),
    ton: null,
    usdt: 'по курсу',
  }),
  // после оплаты — обычная карта с кодом: логотип платформы, номинал карты и страна
  summary: (_values, options) => ({
    brand: options.edition.platform,
    nominal: options.edition.voucher.short_name,
    region: options.region?.label ?? '',
    regionCode: options.region?.code ?? '',
  }),
  order: (values, method, options) =>
    cardsOrder('/api/vouchers/create_order', () => ({
      type: options.edition.platform,
      service_id: options.edition.service_id,
      voucher_id: options.edition.voucher.id,
    }))(values, method),
}

export const PRODUCTS = Object.freeze({ stars, premium, gram, gifts, steam, cards, gta })

/** Разделы, где после оплаты выдаётся код карты (экран с картой и кодом). */
export const CODE_PRODUCTS = ['cards', 'gta']

export const checkOrder = (ref) => (ref.shop === 'cards' ? checkCardsOrder(ref) : checkStarsOrder(ref))

/** Значение поля в том виде, в котором его ждёт бэкенд. */
export const normalizeValue = (field, raw) => {
  if (field.key === 'recipient') return normalizeUsername(raw)
  if (field.type === 'number') return field.parse(raw)
  return typeof raw === 'string' ? raw.trim() : raw
}
