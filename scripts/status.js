import { ApiError, request } from './api.js?v=1795515186'
import { CONFIG } from './config.js?v=1795515186'
import { BRANDS } from './brands.js?v=1795515186'
import { copyText, el, flagImage, isSafeLink, logoIcon, paintBrand, svgEl, textWithIcons } from './dom.js?v=1795515186'
import { ORDER_STATE, buildTonLink, flagUrl, trimDecimals } from './lib.js?v=1795515186'
import { CODE_PRODUCTS, PRODUCTS, checkOrder } from './products.js?v=1795515186'
import { createGiftPreview } from './gift-preview.js?v=1795515186'
import { revealCode, startScramble } from './codefx.js?v=1795515186'
import { RAFFLE_MIN_TICKETS, raffleCountdown, rafflePrizeImage, rafflePrizeName, ticketsFor, ticketsWord } from './raffle.js?v=1795515186'
import { openRafflePrize, openRaffleRules } from './raffle-rules.js?v=1795515186'
import { mixHex } from './hero-math.js?v=1795515186'
import { giftLink, validGift } from './gift-link.js?v=1795515186'
import { canShareInTelegram, imageToBase64, logoColor, renderGiftImage, shareGift, shareInTelegram } from './gift-share.js?v=1795515186'

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

const COPY_HINT = '⧉ нажмите, чтобы скопировать'
const COPIED_HINT = '✓ Код скопирован'

/** Заголовок над картой гифт-карты: что сейчас с заказом. Подсказка на самой карте — только «нажмите, чтобы скопировать». */
// У каждого этапа заголовок и одна строка пояснения — так карта под ними не прыгает,
// когда «Оплата получена» сменяется на «Код готов».
const CARD_HEADING = {
  issuing: ['Оплата *получена*', () => 'Выпускаем код, это пара секунд'],
  // в Telegram бот пришлёт код в свой чат; в обычном браузере код появится на этой странице
  delayed: ['Код задерживается', () => (isInTelegram() ? 'Пришлём код в чат бота, как появится' : 'Код появится здесь сам')],
  ready: ['Gift-карта *готова*',(brand) => `Скопируйте и активируйте в ${brand.label}`],
  // получатель открыл ссылку, которой с ним поделились
  received: ['Вам *подарили* карту', (brand) => `Скопируйте и активируйте в ${brand.label}`],
}

/**
 * Заголовок экрана после оплаты. Слово-результат в *звёздочках* («Gift-карта *готова*»)
 * переливается тем же градиентом, что «покупаем?» на главном экране: глаз сразу видит, что получилось.
 * У ошибок и ожидания звёздочек нет — они остаются белыми.
 */
const statusTitle = (text) =>
  el(
    'p',
    { class: 'status__title' },
    text
      .split(/\*([^*]+)\*/)
      .map((part, index) => (index % 2 === 1 ? el('span', { class: 'shine', text: part }) : part))
      .filter(Boolean),
  )

/** Короткий отклик карты на копирование и вибрация «успех» в Telegram. */
const CARD_TAP = [{ transform: 'scale(1)' }, { transform: 'scale(0.985)' }, { transform: 'scale(1)' }]
const CARD_TAP_MS = 260
const hapticSuccess = () => window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success')

const isInTelegram = () => document.documentElement.classList.contains('is-telegram')

const cardHeading = (stage, brand) => {
  const [title, text] = CARD_HEADING[stage]
  return [statusTitle(title), el('p', { class: 'status__text', text: text(brand) })]
}

/**
 * Карта гифт-карты: фирменные цвета сервиса, номинал, регион и код.
 * Пока код выпускается (codes пустой), его символы перебираются; когда код пришёл —
 * они по очереди встают на место. Код копируется нажатием на любое место карты
 * (отдельной кнопки нет — её заменяет заметная подсказка и отклик «✓ Код скопирован»).
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
    const isCopied = await copyText(value)
    hint.textContent = isCopied ? COPIED_HINT : 'выделите и скопируйте вручную'
    hint.classList.toggle('code-card__hint--done', isCopied)
    if (isCopied) {
      hapticSuccess()
      card.animate(CARD_TAP, { duration: CARD_TAP_MS, easing: 'ease-out' })
    }
    setTimeout(() => {
      hint.textContent = COPY_HINT
      hint.classList.remove('code-card__hint--done')
    }, COPIED_FEEDBACK_MS)
  }
  const codeNodes = isReady
    ? codes.map((code) => {
        const button = el('button', {
          class: 'code-card__code',
          type: 'button',
          onClick: (event) => {
            event.stopPropagation() // не копировать заодно и все коды по нажатию на карту
            copy(code)
          },
        })
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
  // готовая карта целиком — кнопка «скопировать»: нажатие в любом месте копирует код
  card.setAttribute('role', 'button')
  card.setAttribute('tabindex', '0')
  card.setAttribute('aria-label', `Скопировать код ${brand.label}`)
  card.addEventListener('click', () => copy(codes.join('\n')))
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    copy(codes.join('\n'))
  })
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
  // один код копируется нажатием на карту; кнопка нужна, только когда кодов несколько
  const copyAll =
    codes.length > 1 &&
    el('button', {
      class: `btn ${activate ? 'btn--ghost' : 'code-card__copy'}`,
      type: 'button',
      text: 'Скопировать все коды',
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

// не «Поделиться»: человек дарит эту карту другому — так и пишем
const SHARE_LABEL = 'Подарить эту карту'
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
    class: 'status__link',
    type: 'button',
    'data-role': 'gift',
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

// ── Розыгрыш NFT после покупки ───────────────────────────────────────
// Как в боте звёзд: каждый день в 20:00 (МСК) разыгрывается NFT-подарок, билеты — только за звёзды
// (1 за 50). Покупателю на сайте без Telegram бэкенд билеты не начисляет — ему не обещаем.
/**
 * Розыгрыш — минимум слов. Заголовок: участвует ли человек; под ним — его билеты
 * (а если билетов нет — какой подарок разыгрывается). Как в боте: 1 билет за 50 звёзд,
 * участвуют от 3 билетов за день, розыгрыш в 20:00 по Москве.
 */
const raffleState = (order) => {
  // покупка не звёзд или гость сайта: билетов этой покупки не знаем — просто называем розыгрыш
  if (order.productId !== 'stars' || !isInTelegram()) return { title: 'Розыгрыш NFT', line: rafflePrizeName(), isIn: false }
  const tickets = ticketsFor(order.summary?.amount)
  if (tickets === 0) return { title: 'Не участвуете', line: 'Билет — за 50 звёзд', isIn: false }
  if (tickets < RAFFLE_MIN_TICKETS) return { title: 'Не участвуете', line: `${tickets} из ${RAFFLE_MIN_TICKETS} билетов`, isIn: false }
  return { title: 'Вы участвуете', line: `${tickets} ${ticketsWord(tickets)}`, isIn: true }
}

/** Таймер до розыгрыша: тикает раз в секунду, пока строка на экране. */
const COUNTDOWN_TICK_MS = 1000
const countdownNode = () => {
  const node = el('strong', { class: 'draw-card__clock', text: raffleCountdown() })
  const timer = setInterval(() => {
    if (!node.isConnected) {
      clearInterval(timer)
      return
    }
    node.textContent = raffleCountdown()
  }, COUNTDOWN_TICK_MS)
  return node
}

/**
 * Плашка розыгрыша после покупки. Верхний ярус: картинка подарка (нажатие — окно подарка
 * в Telegram), статус и билеты, справа отсчёт и «?» (нажатие — правила). Нижний, за тонкой
 * линией: «Пригласить друга · +1 билет» (только в Telegram, где известен свой id).
 */
const raffleRow = (order) => {
  const state = raffleState(order)
  return el('div', { class: 'draw-card' }, [
    el('div', { class: 'draw-card__main' }, [
      el('button', {
        class: 'draw-card__prize-button',
        type: 'button',
        'aria-label': `Посмотреть подарок ${rafflePrizeName()}`,
        onClick: openRafflePrize,
      }, [el('img', { class: 'draw-card__image', src: rafflePrizeImage(), alt: '', width: '44', height: '44' })]),
      el('button', {
        class: 'draw-card__info',
        type: 'button',
        'aria-label': `Розыгрыш ${rafflePrizeName()}: ${state.title}, ${state.line}. До итогов ${raffleCountdown()}. Правила`,
        onClick: openRaffleRules,
      }, [
        // две короткие строки: участвует ли человек в розыгрыше этого NFT — и его билеты
        el('span', { class: 'draw-card__text' }, [
          el('span', { class: `draw-card__title${state.isIn ? ' draw-card__title--in' : ''}`, text: state.title }),
          el('span', { class: 'draw-card__line', text: state.line }),
        ]),
        countdownNode(),
        el('span', { class: 'draw-card__help', text: '?', 'aria-hidden': 'true' }),
      ]),
    ]),
    inviteButton(),
  ])
}

const VIEW = {
  [ORDER_STATE.PENDING]: pendingView,
  [ORDER_STATE.PAID]: (order) =>
    (isVoucherOrder(order) && codeCard(order, [], 'issuing')) || [
    el('div', { class: 'status__spinner' }),
    statusTitle('Оплата *получена*'),
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
      statusTitle(PRODUCTS[order.productId].doneText),
      order.summary?.line && el('p', { class: 'status__text' }, textWithIcons(order.summary.line)),
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
// ── Приглашение друга: +1 билет в розыгрыш ───────────────────────────
// Как в боте звёзд: ссылка stars.buddygpt.ru/ref_<id в Telegram>; друг открывает мини-приложение
// по ней, бэкенд регистрирует приглашение (/api/set_referral) и даёт пригласившему билет.
// Только в Telegram: свой id мини-приложению сообщает Telegram, у гостя сайта его нет.
const INVITE_TEXT = 'Покупаю звёзды, Premium и Gift-карты в Buddy — заходи 👇'

const inviteLink = () => {
  const id = window.Telegram?.WebApp?.initDataUnsafe?.user?.id
  return Number.isSafeInteger(id) && id > 0 ? `${CONFIG.starsApi}/ref_${id}` : null
}

const inviteButton = () => {
  const link = inviteLink()
  const telegram = window.Telegram?.WebApp
  if (!link || !telegram?.openTelegramLink) return null
  return el('button', {
    // маленькая кнопка внутри золотой плашки розыгрыша: это про билеты, а не про карту
    class: 'draw-card__invite',
    type: 'button',
    text: 'Пригласить друга · +1 билет',
    'aria-label': 'Пригласить друга — плюс один билет в розыгрыш',
    onClick: () => {
      const params = new URLSearchParams({ url: link, text: INVITE_TEXT })
      telegram.openTelegramLink(`https://t.me/share/url?${params}`)
    },
  })
}

// ── Смена заголовка ─────────────────────────────────────────────────
// «Оплата получена · Выпускаем код» → «Gift-карта готова · Скопируйте…»: прежние строки мягко
// тают и уходят вверх, новые проявляются снизу. Строки одной высоты — ниже ничего не сдвигается.
const HEADING_OUT = [
  { opacity: 1, transform: 'none', filter: 'blur(0)' },
  { opacity: 0, transform: 'translateY(-0.375rem)', filter: 'blur(3px)' },
]
const HEADING_IN = [
  { opacity: 0, transform: 'translateY(0.5rem)', filter: 'blur(4px)' },
  { opacity: 1, transform: 'none', filter: 'blur(0)' },
]
const HEADING_OUT_MS = 200
const HEADING_IN_MS = 460
const HEADING_TEXT_DELAY_MS = 70

/** Заголовок и строка под ним, если они стоят первыми на экране. */
const headingOf = (container) => {
  const title = container.querySelector(':scope > .status__title')
  const text = title?.nextElementSibling?.classList.contains('status__text') ? title.nextElementSibling : null
  return title ? { title, text } : null
}

const swapHeading = (previous, next) => {
  const isSame = !previous || !next || previous.title.textContent === next.title.textContent
  if (isSame || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const pairs = [[previous.title, next.title], [previous.text, next.text]].filter(([before, after]) => before && after)
  // на миг возвращаем прежние строки на их место — они растворяются, затем встают новые
  pairs.forEach(([before, after]) => after.replaceWith(before))
  const fading = pairs.map(([before]) =>
    before.animate(HEADING_OUT, { duration: HEADING_OUT_MS, easing: 'ease-in', fill: 'forwards' }).finished,
  )
  Promise.all(fading).then(() => {
    pairs.forEach(([before, after], index) => {
      if (!before.isConnected) return // экран уже перерисован или закрыт
      before.replaceWith(after)
      after.animate(HEADING_IN, {
        duration: HEADING_IN_MS,
        delay: index * HEADING_TEXT_DELAY_MS,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        fill: 'backwards',
      })
    })
  })
}

/** Кнопки и плашка появляются по очереди, мягко всплывая (порядок — в --rise-index). */
const riseIn = (container) => {
  container.querySelectorAll(':scope > .btn, .draw-card, .status__links').forEach((node, index) => {
    node.classList.add('status__rise')
    node.style.setProperty('--rise-index', String(index))
  })
}

/** Цвет экрана после покупки: у Gift-карт — цвет сервиса, у остальных — цвет раздела. */
const statusAccent = (order) => {
  const brand = BRANDS[String(order.summary?.brand ?? '')]
  if (isVoucherOrder(order) && brand) return brand.to
  const capsule = document.querySelector(`.product[data-product="${order.productId}"]`)
  const color = capsule ? getComputedStyle(capsule).getPropertyValue('--product-color').trim() : ''
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_ACCENT
}
const DEFAULT_ACCENT = '#ffb224'
/** Фон кнопок (--color-surface-2) и доля фона в оттенке: чем больше, тем спокойнее цвет. */
const SURFACE = '#0a0a0c'
const BUTTON_TINT = 0.86
const BUTTON_TINT_HOVER = 0.76
const RING_TINT = 0.6

export const showStatus = (container, order, onClose) => {
  // кнопки экрана — с оттенком цвета сервиса или раздела, цвета готовые (см. стили .status .btn--ghost)
  const accent = statusAccent(order)
  container.style.setProperty('--status-accent', accent)
  container.style.setProperty('--status-button', mixHex(accent, SURFACE, BUTTON_TINT))
  container.style.setProperty('--status-button-hover', mixHex(accent, SURFACE, BUTTON_TINT_HOVER))
  container.style.setProperty('--status-ring', mixHex(accent, SURFACE, RING_TINT))
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
    const isDone = result.state === ORDER_STATE.DONE
    const viewItems = VIEW[result.state](order, result).filter(Boolean)
    // «Подарить эту карту» уходит из середины экрана вниз — в строку тихих ссылок
    const gift = viewItems.find((node) => node.dataset?.role === 'gift') ?? null
    const items = viewItems.filter((node) => node !== gift)
    // После успешной покупки — строка розыгрыша: картинка подарка, участвует ли человек, «+1 за друга».
    const raffleBlock = isDone ? raffleRow(order) : null
    const previousHeading = headingOf(container)
    const links = el('div', { class: 'status__links' }, [
      gift,
      el('button', {
        class: 'status__link',
        type: 'button',
        text: isFinal ? 'Новая покупка' : 'Отменить и вернуться',
        onClick: close,
      }),
    ].filter(Boolean))
    container.replaceChildren(...[...items, raffleBlock, links].filter(Boolean))
    riseIn(container)
    swapHeading(previousHeading, headingOf(container))
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
