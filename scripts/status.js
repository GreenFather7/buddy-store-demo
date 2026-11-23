import { ApiError, request } from './api.js?v=1795434061'
import { CONFIG } from './config.js?v=1795434061'
import { BRANDS } from './brands.js?v=1795434061'
import { copyText, el, flagImage, isSafeLink, logoIcon, paintBrand, svgEl, textWithIcons } from './dom.js?v=1795434061'
import { ORDER_STATE, buildTonLink, flagUrl, trimDecimals } from './lib.js?v=1795434061'
import { CODE_PRODUCTS, PRODUCTS, checkOrder } from './products.js?v=1795434061'
import { createGiftPreview } from './gift-preview.js?v=1795434061'
import { revealCode, startScramble } from './codefx.js?v=1795434061'
import { giftLink, validGift } from './gift-link.js?v=1795434061'
import { canShareInTelegram, imageToBase64, logoColor, renderGiftImage, shareGift, shareInTelegram } from './gift-share.js?v=1795434061'

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
  // в Telegram бот пришлёт код в свой чат; в обычном браузере код появится на этой странице
  delayed: ['Код задерживается', () => (isInTelegram() ? 'Пришлём код в чат бота, как появится' : 'Код появится здесь сам')],
  ready: ['Gift-карта готова',(brand) => `Скопируйте и активируйте в ${brand.label}`],
  // получатель открыл ссылку, которой с ним поделились
  received: ['Вам подарили карту', (brand) => `Скопируйте и активируйте в ${brand.label}`],
}

const isInTelegram = () => document.documentElement.classList.contains('is-telegram')

const cardHeading = (stage, brand) => {
  const [title, text] = CARD_HEADING[stage]
  return [el('p', { class: 'status__title', text: title }), el('p', { class: 'status__text', text: text(brand) })]
}

/**
 * Карта гифт-карты: фирменные цвета сервиса, номинал, регион и код.
 * Пока код выпускается (codes пустой), его символы перебираются; когда код пришёл —
 * они по очереди встают на место, и появляется кнопка «Скопировать код».
 * @param {'issuing'|'delayed'} [waiting] почему кода ещё нет
 * @param {{ isReceived?: boolean }} [options] карту открыл получатель подарка — без «Поделиться»
 */
const codeCard = (order, codes, waiting = 'issuing', { isReceived = false } = {}) => {
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
      // логотип в цвет бренда без подложки и название по его центру — как карты в боте гифт-карт
      el('span', { class: 'code-card__brand' }, [
        logoIcon(brand.path, 'code-card__logo'),
        el('span', { class: 'code-card__name', text: brand.label }),
      ]),
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
  card.style.setProperty('--logo-color', logoColor(brandId))
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
  const share = !isReceived && shareButton(order, codes)
  return [...cardHeading(isReceived ? 'received' : 'ready', brand), paintBrand(card, brand), activate, copyAll, share].filter(
    Boolean,
  )
}

const SHARE_LABEL = 'Поделиться'
const SHARE_RESULT = { copied: 'Ссылка скопирована', failed: 'Не получилось, скопируйте код' }

/**
 * «Поделиться» картой: картинка карты и ссылка, по которой получатель скопирует код.
 * Картинка рисуется сразу, пока покупатель смотрит на код, — к нажатию она уже готова.
 */
const shareButton = (order, codes) => {
  const gift = validGift({ ...order.summary, codes })
  if (!gift) return null
  let image = null
  let imageBase64 = null
  // В Telegram сообщение готовит бот по заказу из базы — в тестовом режиме заказов там нет.
  const isTelegramShare = !CONFIG.demo && order.ref?.shop === 'cards' && canShareInTelegram()
  renderGiftImage(gift)
    .then(async (file) => {
      image = file
      if (file && isTelegramShare) imageBase64 = await imageToBase64(file)
    })
    .catch((error) => console.error('Картинка карты не нарисовалась', error))
  const button = el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: SHARE_LABEL,
    onClick: async () => {
      if (isTelegramShare && imageBase64) {
        button.disabled = true
        const isShared = await shareInTelegram(order.ref.orderId, imageBase64, request)
        button.disabled = false
        if (isShared) return
      }
      const result = await shareGift(gift, giftLink(gift, window.location.href), image)
      if (!SHARE_RESULT[result]) return
      button.textContent = SHARE_RESULT[result]
      setTimeout(() => {
        button.textContent = SHARE_LABEL
      }, COPIED_FEEDBACK_MS)
    },
  })
  return button
}

// Кнопка «Активировать» — только у App Store: его страница активации сама подставляет код
// из ссылки (apps.apple.com/redeem?code=…), и покупателю остаётся подтвердить.
// У остальных сервисов кнопки нет — код копируется и вводится на их сайте.
const ACTIVATE_WITH_CODE = {
  app: (code) => `https://apps.apple.com/redeem?code=${encodeURIComponent(code)}`,
}

/** Ссылка активации с подставленным кодом или null, если у сервиса такой нет. */
const activationLink = (brandId, code) =>
  ACTIVATE_WITH_CODE[brandId] ? { url: ACTIVATE_WITH_CODE[brandId](code), isFilled: true } : null


/** Заказ гифт-карты с кодом (не Steam): пока ждём код, показываем карту с перебором. */
const isVoucherOrder = (order) => CODE_PRODUCTS.includes(order.productId) && Object.hasOwn(BRANDS, String(order.summary?.brand ?? ''))

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
      el('p', { class: 'status__text', text: 'Комментарий к переводу обязателен' }),
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
    el('p', { class: 'status__text', text: 'Статус обновится здесь сам' }),
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
    el('p', { class: 'status__text', text: 'Отправляем, обычно пара минут' }),
  ],
  [ORDER_STATE.DELAYED]: (order) =>
    (isVoucherOrder(order) && codeCard(order, [], 'delayed')) || [
    el('div', { class: 'status__spinner' }),
    el('p', { class: 'status__title', text: 'Код задерживается' }),
    el('p', { class: 'status__text', text: isInTelegram() ? 'Пришлём в чат бота, как будет готово' : 'Оплата прошла, ждём выдачу' }),
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
          el('p', { class: 'status__text', text: 'Деньги не списаны, попробуйте снова' }),
        ]
      : [
          failMark(),
          el('p', { class: 'status__title', text: 'Заказ не выполнен' }),
          el('p', { class: 'status__text', text: 'Если деньги списались — напишите нам' }),
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

/**
 * Карта, которой поделились: получатель видит её с кнопкой «Скопировать код»
 * (у App Store — и «Активировать»), а ниже — «Купить себе», чтобы перейти в магазин.
 * @param {HTMLElement} container
 * @param {import('./gift-link.js').Gift} gift
 * @param {() => void} onClose
 */
export const showGift = (container, gift, onClose) => {
  const order = { summary: { brand: gift.brand, nominal: gift.nominal, region: gift.region, regionCode: gift.regionCode } }
  container.replaceChildren(
    ...codeCard(order, gift.codes, 'issuing', { isReceived: true }),
    el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: 'Купить себе',
      onClick: () => {
        container.hidden = true
        container.replaceChildren()
        onClose()
      },
    }),
  )
  container.hidden = false
}
