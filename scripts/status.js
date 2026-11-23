import { ApiError } from './api.js'
import { CONFIG } from './config.js'
import { BRANDS } from './brands.js'
import { copyText, el, flagImage, isSafeLink, logoIcon, paintBrand, svgEl, textWithIcons } from './dom.js'
import { ORDER_STATE, buildTonLink, flagUrl, trimDecimals } from './lib.js'
import { PRODUCTS, checkOrder } from './products.js'
import { createGiftPreview } from './gift-preview.js'
import { revealCode, startScramble } from './codefx.js'

const ORDER_KEY = 'buddy.order'
const PENDING_LIFETIME_MS = 30 * 60 * 1000
const COPIED_FEEDBACK_MS = 1500
const HTTP_NOT_FOUND = 404
const SUPPORT_URL = 'https://t.me/Buddy_support_bot'

const FINAL_STATES = [ORDER_STATE.DONE, ORDER_STATE.FAILED]

// ── Хранение текущего заказа: переживает уход на страницу оплаты ──
const isValidOrder = (order) =>
  Boolean(order) &&
  typeof order === 'object' &&
  Object.hasOwn(PRODUCTS, order.productId) &&
  ['stars', 'cards'].includes(order.ref?.shop) &&
  ['string', 'number'].includes(typeof order.ref?.orderId) &&
  Number.isFinite(order.createdAt)

export const loadOrder = () => {
  try {
    const order = JSON.parse(localStorage.getItem(ORDER_KEY) ?? 'null')
    return isValidOrder(order) ? order : null
  } catch {
    return null
  }
}

export const saveOrder = (order) => {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  } catch {
    // без хранилища статус виден, пока открыта вкладка
  }
}

const clearOrder = () => {
  try {
    localStorage.removeItem(ORDER_KEY)
  } catch {
    // нечего чистить
  }
}

// ── Отрисовка ─────────────────────────────────────────────────────
const copyButton = (label, value) =>
  el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: label,
    onClick: async (event) => {
      const button = event.currentTarget
      const copied = await copyText(value)
      button.textContent = copied ? 'Скопировано' : 'Выделите и скопируйте вручную'
      setTimeout(() => {
        button.textContent = label
      }, COPIED_FEEDBACK_MS)
    },
  })

const COPY_HINT = 'нажмите, чтобы скопировать'

/** Заголовок над картой гифт-карты: что сейчас с заказом. Подсказка на самой карте — только «нажмите, чтобы скопировать». */
// У каждого этапа заголовок и одна строка пояснения — так карта под ними не прыгает,
// когда «Оплата получена» сменяется на «Код готов».
const CARD_HEADING = {
  issuing: ['Оплата получена', () => 'Выпускаем код, это пара секунд'],
  delayed: ['Код задерживается', () => 'Оплата прошла, код появится здесь сам'],
  ready: ['Код готов', (brand) => `Скопируйте и активируйте в ${brand.label}`],
}

const cardHeading = (stage, brand) => {
  const [title, text] = CARD_HEADING[stage]
  return [el('p', { class: 'status__title', text: title }), el('p', { class: 'status__text', text: text(brand) })]
}

/**
 * Карта гифт-карты: фирменные цвета сервиса, номинал, регион и код.
 * Пока код выпускается (codes пустой), его символы перебираются; когда код пришёл —
 * они по очереди встают на место, и появляется кнопка «Скопировать код».
 * @param {'issuing'|'delayed'} [waiting] почему кода ещё нет
 */
const codeCard = (order, codes, waiting = 'issuing') => {
  const brandId = String(order.summary?.brand ?? '')
  if (!Object.hasOwn(BRANDS, brandId)) return null
  const brand = BRANDS[brandId]
  const isReady = codes.length > 0
  // пока кода нет, место подсказки пустое — карта не меняет высоту, когда код появится
  const hint = el('p', { class: 'code-card__hint', text: isReady ? COPY_HINT : '\u00a0' })
  const copy = async (value) => {
    hint.textContent = (await copyText(value)) ? 'скопировано' : 'выделите и скопируйте вручную'
    setTimeout(() => {
      hint.textContent = COPY_HINT
    }, COPIED_FEEDBACK_MS)
  }
  const codeNodes = isReady
    ? codes.map((code) => {
        const button = el('button', { class: 'code-card__code', type: 'button', onClick: () => copy(code) })
        revealCode(button, code)
        return button
      })
    : [el('span', { class: 'code-card__code code-card__code--waiting', 'aria-hidden': 'true' })]
  if (!isReady) startScramble(codeNodes[0])
  const card = el('div', { class: `code-card${isReady ? ' code-card--ready' : ''}` }, [
    el('div', { class: 'code-card__head' }, [
      el('span', { class: 'code-card__logo' }, [logoIcon(brand.path)]),
      el('span', { class: 'code-card__name', text: brand.label }),
      el('span', { class: 'code-card__value' }, [
        el('strong', { text: String(order.summary.nominal ?? '') }),
        order.summary.region &&
          el('span', { class: 'code-card__region' }, [
            flagUrl(order.summary.regionCode) && flagImage(flagUrl(order.summary.regionCode)),
            String(order.summary.region),
          ]),
      ]),
    ]),
    el('p', { class: 'code-card__label', text: 'Код активации' }),
    ...codeNodes,
    hint,
  ])
  if (!isReady) return [...cardHeading(waiting, brand), paintBrand(card, brand)]
  const activation = activationLink(brandId, codes[0])
  const activate =
    activation &&
    isSafeLink(activation.url) &&
    el('a', {
      class: 'btn code-card__copy',
      href: activation.url,
      target: '_blank',
      rel: 'noopener',
      text: `Активировать в ${brand.label}`,
      onClick: (event) => {
        // страница без подстановки кода: код уже в буфере, остаётся вставить
        if (!activation.isFilled) copyText(codes[0])
        // внутри Telegram ссылку открывает сам Telegram — так она точно уйдёт в браузер или App Store
        const telegram = window.Telegram?.WebApp
        if (telegram?.openLink) {
          event.preventDefault()
          telegram.openLink(activation.url)
        }
      },
    })
  const copyAll = el('button', {
    class: `btn ${activate ? 'btn--ghost' : 'code-card__copy'}`,
    type: 'button',
    text: 'Скопировать код',
    onClick: () => copy(codes.join('\n')),
  })
  ;[activate, copyAll].filter(Boolean).forEach((button) => {
    button.style.setProperty('--brand-from', brand.from)
    button.style.setProperty('--brand-to', brand.to)
  })
  return [...cardHeading('ready', brand), paintBrand(card, brand), activate, copyAll].filter(Boolean)
}

// Кнопка «Активировать» — как в мини-приложении и боте гифт-карт (constans.ACTIVATE_URLS):
// у App Store, Google Play и Roblox код уходит прямо в ссылку и подставляется сам;
// у остальных открывается страница ввода кода, а код заранее кладётся в буфер обмена.
const ACTIVATE_WITH_CODE = {
  app: (code) => `https://apps.apple.com/redeem?code=${encodeURIComponent(code)}`,
  gplay: (code) => `https://play.google.com/redeem?code=${encodeURIComponent(code)}`,
  roblox: (code) => `https://www.roblox.com/redeem?code=${encodeURIComponent(code)}`,
}
const ACTIVATE_PAGE = {
  ps: 'https://store.playstation.com/redeem',
  xbox: 'https://redeem.microsoft.com',
  nintendo: 'https://ec.nintendo.com/redeem',
  netflix: 'https://www.netflix.com/redeem',
  spotify: 'https://www.spotify.com/redeem',
}

/** Ссылка активации: сам код, если это уже ссылка (так выдаёт Nintendo), иначе — по сервису. */
const activationLink = (brandId, code) => {
  if (/^https:\/\//i.test(code)) return { url: code, isFilled: true }
  if (ACTIVATE_WITH_CODE[brandId]) return { url: ACTIVATE_WITH_CODE[brandId](code), isFilled: true }
  if (ACTIVATE_PAGE[brandId]) return { url: ACTIVATE_PAGE[brandId], isFilled: false }
  return null
}

/** Заказ гифт-карты с кодом (не Steam): пока ждём код, показываем карту с перебором. */
const isVoucherOrder = (order) => order.productId === 'cards' && Object.hasOwn(BRANDS, String(order.summary?.brand ?? ''))

const payLink = (label, url) =>
  isSafeLink(url)
    ? el('a', { class: 'btn btn--gold', href: url, target: '_blank', rel: 'noopener', text: label })
    : null

const pendingView = (order) => {
  if (order.kind === 'ton' && order.ton) {
    const { address, amountTon, memo } = order.ton
    return [
      el('div', { class: 'status__spinner' }),
      el('p', { class: 'status__title', text: `Переведите ${trimDecimals(amountTon)} TON` }),
      el('p', { class: 'status__text', text: 'Комментарий к переводу обязателен — по нему мы найдём платёж.' }),
      payLink('Открыть кошелёк', buildTonLink({ address, amountTon, memo })),
      el('code', { class: 'status__code', text: address }),
      copyButton('Скопировать адрес', address),
      el('code', { class: 'status__code', text: memo }),
      copyButton('Скопировать комментарий', memo),
    ]
  }
  return [
    el('div', { class: 'status__spinner' }),
    el('p', { class: 'status__title', text: 'Ждём оплату' }),
    el('p', { class: 'status__text', text: 'Статус обновится здесь сам, страницу можно не закрывать.' }),
    payLink(order.method === 'usdt' ? 'Оплатить в CryptoBot' : 'Перейти к оплате', order.url),
  ]
}

// ── Значки итога ──────────────────────────────────────────────────
/** Галочка, которая прорисовывается в круге, и искры вокруг. У подарка — сам подарок с анимацией. */
const successMark = (order) => {
  if (order.summary?.gift) {
    const slot = el('span', { class: 'status__gift', 'aria-hidden': 'true' })
    createGiftPreview(slot).show(order.summary.gift)
    return el('div', { class: 'status__mark status__mark--gift' }, [slot, sparks()])
  }
  const icon = svgEl('svg', { class: 'status__mark-icon', viewBox: '0 0 52 52', 'aria-hidden': 'true' }, [
    svgEl('circle', { class: 'status__mark-ring', cx: '26', cy: '26', r: '24' }),
    svgEl('path', { class: 'status__mark-check', d: 'M15 27l7.5 7.5L37.5 19' }),
  ])
  return el('div', { class: 'status__mark status__mark--done' }, [icon, sparks()])
}

const SPARK_COUNT = 10

const sparks = () =>
  el(
    'span',
    { class: 'status__sparks', 'aria-hidden': 'true' },
    Array.from({ length: SPARK_COUNT }, (_, index) => {
      const spark = el('i', {})
      spark.style.setProperty('--angle', `${(360 / SPARK_COUNT) * index}deg`)
      return spark
    }),
  )

const failMark = () =>
  el('div', { class: 'status__mark status__mark--fail' }, [
    svgEl('svg', { class: 'status__mark-icon', viewBox: '0 0 52 52', 'aria-hidden': 'true' }, [
      svgEl('circle', { class: 'status__mark-ring', cx: '26', cy: '26', r: '24' }),
      svgEl('path', { class: 'status__mark-check', d: 'M18 18l16 16M34 18L18 34' }),
    ]),
  ])

const VIEW = {
  [ORDER_STATE.PENDING]: pendingView,
  [ORDER_STATE.PAID]: (order) =>
    (isVoucherOrder(order) && codeCard(order, [], 'issuing')) || [
    el('div', { class: 'status__spinner' }),
    el('p', { class: 'status__title', text: 'Оплата получена' }),
    el('p', { class: 'status__text', text: 'Отправляем. Обычно это занимает пару минут.' }),
  ],
  [ORDER_STATE.DELAYED]: (order) =>
    (isVoucherOrder(order) && codeCard(order, [], 'delayed')) || [
    el('div', { class: 'status__spinner' }),
    el('p', { class: 'status__title', text: 'Код задерживается' }),
    el('p', { class: 'status__text', text: 'Оплата прошла. Код появится здесь, как только поставщик его выдаст.' }),
  ],
  [ORDER_STATE.DONE]: (order, result) =>
    ((result.codes ?? []).length > 0 && codeCard(order, result.codes)) || [
      successMark(order),
      el('p', { class: 'status__title', text: PRODUCTS[order.productId].doneText }),
      order.summary?.line && el('p', { class: 'status__text' }, textWithIcons(order.summary.line)),
      order.raffleNote && el('p', { class: 'status__raffle', text: `🎟 ${order.raffleNote}` }),
      ...(result.codes ?? []).flatMap((code) => [
        el('code', { class: 'status__code', text: code }),
        copyButton('Скопировать код', code),
      ]),
    ],
  [ORDER_STATE.FAILED]: (_order, result) =>
    result.reason === 'declined'
      ? [
          failMark(),
          el('p', { class: 'status__title', text: 'Оплата не прошла' }),
          el('p', { class: 'status__text', text: 'Деньги не списаны. Попробуйте ещё раз или выберите другой способ оплаты.' }),
        ]
      : [
          failMark(),
          el('p', { class: 'status__title', text: 'Заказ не выполнен' }),
          el('p', { class: 'status__text', text: 'Если деньги списались, напишите в поддержку — вернём или довыдадим.' }),
          el('a', { class: 'btn btn--ghost', href: SUPPORT_URL, target: '_blank', rel: 'noopener', text: 'Поддержка' }),
        ],
}

/**
 * Показывает статус заказа и опрашивает бэкенд, пока заказ не завершится.
 * @param {HTMLElement} container
 * @param {object} order сохранённый заказ
 * @param {() => void} onClose вернуться к форме
 */
export const showStatus = (container, order, onClose) => {
  let timer = 0
  let isClosed = false
  let lastKey = ''

  const close = () => {
    isClosed = true
    clearTimeout(timer)
    clearOrder()
    container.hidden = true
    container.replaceChildren()
    onClose()
  }

  const render = (result) => {
    // Перерисовываем только при смене состояния: кнопки не теряют фокус и надпись «Скопировано».
    const key = `${result.state}:${result.reason ?? ''}:${(result.codes ?? []).length}`
    if (key === lastKey) return
    lastKey = key
    const isFinal = FINAL_STATES.includes(result.state)
    container.replaceChildren(
      ...VIEW[result.state](order, result).filter(Boolean),
      el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        text: isFinal ? 'Новая покупка' : 'Отменить и вернуться',
        onClick: close,
      }),
    )
  }

  const poll = async () => {
    if (isClosed) return
    let result
    try {
      result = await checkOrder(order.ref)
    } catch (error) {
      // Заказ не найден (например, очищены данные сайта) — показывать нечего.
      const isMissing = error instanceof ApiError && error.status === HTTP_NOT_FOUND
      result = { state: isMissing ? ORDER_STATE.FAILED : ORDER_STATE.PENDING }
      if (!isMissing && lastKey) result = null // временный сбой сети: оставляем прежний экран
    }
    if (isClosed) return
    if (result) {
      const isStale = result.state === ORDER_STATE.PENDING && Date.now() - order.createdAt > PENDING_LIFETIME_MS
      if (isStale) return close() // счёт давно истёк, оплаты не было
      render(result)
      // Готовый заказ остаётся в хранилище до «Новая покупка»: код гифт-карты
      // должен пережить обновление страницы — другой копии у гостя нет.
      if (FINAL_STATES.includes(result.state)) return
    }
    timer = setTimeout(poll, CONFIG.statusPollMs)
  }

  container.hidden = false
  // В тестовом режиме исход уже выбран: сразу показываем «оплата получена» или отказ платежа.
  const TEST_START = {
    declined: { state: ORDER_STATE.FAILED, reason: 'declined' },
  }
  render(order.testOutcome ? (TEST_START[order.testOutcome] ?? { state: ORDER_STATE.PAID }) : { state: ORDER_STATE.PENDING })
  poll()
}
