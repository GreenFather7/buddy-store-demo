import { ApiError } from './api.js?v=1795507282'
import { BRANDS } from './brands.js?v=1795507282'
import { CONFIG } from './config.js?v=1795507282'
import { el, flagImage, isSafeLink, logoIcon } from './dom.js?v=1795507282'
import { ensureFreshBuild } from './fresh.js?v=1795507282'
import { createGiftPreview, preloadAnimations, preloadGifts } from './gift-preview.js?v=1795507282'
import { createHero, heroGlyph } from './hero.js?v=1795507282'
import { mixHex } from './hero-math.js?v=1795507282'
import { avatarUrl, describeError, groupThousands } from './lib.js?v=1795507282'
import { PRODUCTS, loadCardServices, normalizeValue } from './products.js?v=1795507282'
import { loadOrder, saveOrder, showGift, showStatus } from './status.js?v=1795507282'
import { readGiftLink } from './gift-link.js?v=1795507282'
import { hapticError, initTelegram } from './telegram.js?v=1795507282'
import { setAmount } from './odometer.js?v=1795507282'
import { askTestPayment, mountBalance } from './testpay.js?v=1795507282'
import { addTicketsForStars, mountRaffle } from './raffle.js?v=1795507282'
import { settleDemoOrder } from './mock.js?v=1795507282'

const QUOTE_DEBOUNCE_MS = 400
const AVATAR_DEBOUNCE_MS = 500
const TAP_SLOP_PX = 10
const HTTP_NOT_FOUND = 404
const SKELETON_COUNT = 4
/** Поле с username получателя в разделах Telegram. */
const RECIPIENT_KEY = 'recipient'
const DEFAULT_PRODUCT = 'stars'
const METHOD_LABEL = { sbp: 'СБП', ton: 'TON', usdt: 'USDT' }
/** Значки способов оплаты — те же, что в мини-приложении звёзд: СБП, кристалл Gram и USDT. */
const METHOD_ICON = { sbp: 'assets/pay/sbp.svg', ton: 'assets/presets/gram-1.svg', usdt: 'assets/pay/usdt.svg' }
const USDT_COLOR = '#1fb5a8'
const STARS_PRODUCT = 'stars'
const GRAM_PRODUCT = 'gram'
const CARDS_PRODUCT = 'cards'
const SERVICE_KEY = 'service'
/** Тёмные фирменные цвета высветляются, чтобы логотип читался на капсуле. */
const BRAND_ICON_LIFT = 0.25

const root = document.querySelector('[data-checkout]')
const productsEl = root.querySelector('[data-products]')
const form = root.querySelector('[data-order]')
const fieldsEl = root.querySelector('[data-fields]')
const payOptionsEl = root.querySelector('[data-pay-options]')
const errorEl = root.querySelector('[data-error]')
const submitEl = root.querySelector('[data-submit]')
const submitLabelEl = root.querySelector('[data-submit-label]')
const noteEl = el('p', { class: 'order__note' })
submitEl.after(noteEl)
const statusEl = root.querySelector('[data-status]')
const titleEl = document.querySelector('.store__title')
const hero = createHero(document.querySelector('[data-hero]'))

/** Состояние формы. Заменяется целиком при смене товара. */
let state = null
let quoteTimer = 0
/** Сколько рядов вариантов сейчас грузится (страны, номиналы) — пока грузятся, кнопка не меняется. */
let pendingOptionLoads = 0
let isHintRecheck = false
let quotedProduct = null
let avatarTimer = 0
let shownRecipient = null
/** key → { wrapper, hint, reload } для полей текущего товара. */
let controls = {}
/** Показ выбранного подарка в строке ввода; есть только в разделе подарков. */
let giftPreview = null

/** Текст ошибки показывается на самой кнопке оплаты: под формой ничего не появляется и не сдвигается. */
let errorMessage = null

const LABEL_IN = [
  { opacity: 0, transform: 'translateY(0.55em)', filter: 'blur(2px)' },
  { opacity: 1, transform: 'none', filter: 'blur(0)' },
]
const LABEL_IN_MS = 320

const PAY_WORD = 'Оплатить'

/** Кнопка оплаты: слово «Оплатить» стоит на месте, сумма рядом прокручивается как счётчик. */
const updateSubmit = () => {
  // пока считается новая цена, на кнопке остаётся прежняя сумма — без мигания «Оплатить»
  if (!errorMessage && !state?.quote && state && canQuote()) return
  submitEl.classList.toggle('order__submit--error', Boolean(errorMessage))
  const isAnimated = !prefersLessMotion.matches
  if (errorMessage) {
    if (submitLabelEl.dataset.error === errorMessage) return
    submitLabelEl.dataset.error = errorMessage
    submitLabelEl.replaceChildren(errorMessage)
    if (isAnimated) {
      submitLabelEl.animate(LABEL_IN, { duration: LABEL_IN_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' })
    }
    return
  }
  const wasError = 'error' in submitLabelEl.dataset
  let amountEl = submitLabelEl.querySelector('.pay-amount')
  if (!amountEl) {
    delete submitLabelEl.dataset.error
    amountEl = el('span', { class: 'pay-amount' })
    submitLabelEl.replaceChildren(el('span', { class: 'pay-word' }), amountEl)
    if (wasError && isAnimated) {
      submitLabelEl.animate(LABEL_IN, { duration: LABEL_IN_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' })
    }
  }
  const price = state?.quote?.[state.method]
  const amount = price && /\d/.test(price) ? price : ''
  const wordEl = submitLabelEl.querySelector('.pay-word')
  const hadAmount = Boolean(amountEl.dataset.value)
  // Пока количество набирают вручную (стёрли «50», набирают «5», «50», «500») или выбор меняется,
  // в том же разделе прежние надпись, сумма и строка под кнопкой остаются приглушёнными,
  // и новая сумма прокручивается от старой. При смене раздела сумма убирается.
  // Гифт-карта не собрана: на кнопке подсказка «Выберите страну» / «Выберите номинал», без цены.
  const hint = state.product.payHint?.(state.values) ?? null
  const isSameProduct = hadAmount && amountEl.dataset.forProduct === state.product.id
  // Внутри раздела, пока грузятся варианты, надпись без цены («Выберите страну») просто
  // остаётся как есть — иначе между подсказками на миг мелькнёт «Оплатить».
  if (hint && pendingOptionLoads > 0 && !hadAmount && amountEl.dataset.forProduct === state.product.id) return
  // Ждём: варианты ещё грузятся (сменили страну — номиналы в пути), цены ещё нет или она
  // посчитана для прежнего выбора. Надпись, сумма и строка под кнопкой потом меняются вместе.
  // Подгрузка вариантов начинается сразу после выбора, но чуть позже этого вызова —
  // перепроверяем подсказку следующим шагом, иначе на миг мелькнёт «Выберите номинал».
  if (hint && pendingOptionLoads === 0 && !isHintRecheck) {
    isHintRecheck = true
    queueMicrotask(() => {
      updateSubmit()
      isHintRecheck = false
    })
    return
  }
  // Цена посчитана, но суммы в этой валюте заранее нет (гифт-карта в USDT — «по курсу»,
  // бэкенд считает её при заказе): это не «ждём», а «Оплатить в USDT» без суммы.
  const isPriceByRate = Boolean(state.quote) && !amount
  const isWaiting = hint ? pendingOptionLoads > 0 : (!amount && !isPriceByRate) || quotedSignature !== priceSignature()
  const isTyping = isWaiting && isSameProduct
  ;[amountEl, wordEl, noteEl].forEach((node) => node.classList.toggle('pay-amount--stale', isTyping))
  if (isTyping) return
  const payWord = state.product.payWord || PAY_WORD
  // пока варианты грузятся, подсказку не показываем — только обычное слово раздела
  const word =
    (pendingOptionLoads === 0 && hint) || (isPriceByRate ? `${payWord} в ${METHOD_LABEL[state.method]}` : payWord)
  if (wordEl.textContent !== word) wordEl.textContent = word
  renderPayNote(hint ? null : (state.product.payNote?.(state.values, state.optionData, state.quote) ?? null))
  const shownAmount = hint ? '' : amount
  setAmount(amountEl, shownAmount, isAnimated && hadAmount)
  amountEl.dataset.forProduct = state.product.id
  amountEl.hidden = !shownAmount
  // первая сумма не «крутится» с нуля, а мягко появляется рядом со словом
  if (amount && !hadAmount && isAnimated) {
    amountEl.animate(LABEL_IN, { duration: LABEL_IN_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' })
  }
  fitSubmitLabel()
}

/**
 * Серая строка под кнопкой: что собрал покупатель гифт-карты («🇹🇷 PlayStation · Турция · 1 500 TL»).
 * У остальных разделов пустая, но место держит — экран не меняет высоту при переключении.
 * Перерисовывается только при смене текста — флаг не мигает.
 */
const renderPayNote = (note) => {
  const key = note ? `${note.flag ?? ''}|${note.text}|${note.link ?? ''}` : ''
  if (noteEl.dataset.key === key) return
  noteEl.dataset.key = key
  // строка со ссылкой (канал) открывается в Telegram, в мини-приложении — его же средствами
  const text = note?.link && isSafeLink(note.link)
    ? el('a', { class: 'order__note-link', href: note.link, target: '_blank', rel: 'noopener', text: note.text, onClick: openInTelegram })
    : note?.text
  noteEl.replaceChildren(...(note ? [note.flag ? flagImage(note.flag) : '', text] : []))
  // новая строка мягко проявляется с лёгким подъёмом — видно, что выбор изменился
  if (note && !prefersLessMotion.matches) {
    noteEl.animate(NOTE_IN, { duration: NOTE_IN_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' })
  }
}

const NOTE_IN = [
  { opacity: 0, transform: 'translateY(0.25rem)', filter: 'blur(2px)' },
  { opacity: 1, transform: 'none', filter: 'none' },
]
const NOTE_IN_MS = 360

/** Ссылки t.me внутри мини-приложения открывает сам Telegram. */
const openInTelegram = (event) => {
  const telegram = window.Telegram?.WebApp
  if (!telegram?.openTelegramLink) return
  event.preventDefault()
  telegram.openTelegramLink(event.currentTarget.href)
}

/**
 * Цвет раздела и готовые оттенки обводки выбранного варианта. Оттенки считаем здесь, а не через
 * color-mix в стилях: старые браузеры (Chrome 111, встроенные браузеры старых Android) рисуют
 * смешанный цвет внутри обводки белым.
 */
const SECTION_SURFACE = '#0a0a0c'
const RING_SOFT = 0.55
const RING_STRONG = 0.4
const setSectionColor = (color) => {
  root.style.setProperty('--section-color', color)
  if (!/^#[0-9a-f]{6}$/i.test(color)) return
  root.style.setProperty('--section-ring', mixHex(color, SECTION_SURFACE, RING_SOFT))
  root.style.setProperty('--section-ring-strong', mixHex(color, SECTION_SURFACE, RING_STRONG))
}

/** Надпись не переносится: если на узком телефоне не влезает, кегль на кнопке чуть меньше. */
const fitSubmitLabel = () => {
  submitEl.classList.remove('order__submit--tight')
  const style = getComputedStyle(submitEl)
  const room = submitEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  submitEl.classList.toggle('order__submit--tight', submitLabelEl.scrollWidth > room)
}

const showError = (text) => {
  errorMessage = text ?? null
  errorEl.textContent = text ?? '' // для экранных дикторов (role="alert")
  if (state) updateSubmit()
}

/** Поле, к которому относится ответ «не найдено»: ник получателя или логин Steam. */
const ACCOUNT_KEYS = ['recipient', 'account']

/** Ошибка сервера: «аккаунт не найден» — красная рамка у поля, остальное — текстом на кнопке. */
const reportError = (error) => {
  const text = errorText(error)
  const field = state.product.fields.find((item) => ACCOUNT_KEYS.includes(item.key))
  if (error instanceof ApiError && error.status === HTTP_NOT_FOUND && field) {
    markInvalid(field, text)
    return
  }
  showError(text)
}

const errorText = (error) => {
  if (!(error instanceof ApiError)) console.error(error) // ошибка в коде, а не в сети — нужна в консоли
  return describeError(error instanceof ApiError ? error.status : 0, state.product.id)
}

const isComplete = () => state.product.fields.every((field) => state.values[field.key] !== undefined)

const priceKeys = () => state.product.quoteKeys ?? state.product.fields.map((field) => field.key)

/** Хватает ли данных для цены: у товаров с quoteKeys — только этих полей (например, количество звёзд без ника). */
const canQuote = () => priceKeys().every((key) => state.values[key] !== undefined)

/** Отпечаток полей, от которых зависит цена: ввод ника у звёзд цену не пересчитывает. */
const priceSignature = () => JSON.stringify(priceKeys().map((key) => state.values[key]))

// ── Шапка ─────────────────────────────────────────────────────────
/** Капсула в строке разделов: раздел или, для гифт-карт, конкретный сервис. */
const capsule = (productId, service) =>
  [...productsEl.querySelectorAll('[data-product]')].find(
    (button) => button.dataset.product === productId && (button.dataset.service ?? '') === (service ?? ''),
  )

const productButton = (productId) => capsule(productId)

/** Контур для частиц: отдельный скрытый (у Premium и «Подарков» иконка — картинка или плитка), иначе сама иконка. */
const glyphSource = (button) => button.querySelector('.product__glyph') ?? button.querySelector('svg')

const productLook = (productId) => {
  const button = productButton(productId)
  return {
    color: getComputedStyle(button).getPropertyValue('--product-color').trim(),
    // у «Звёзд» иконка — картинка, а не контур; их частицы — собственная анимация, контур не нужен
    glyph: glyphSource(button) ? heroGlyph.fromIcon(glyphSource(button)) : undefined,
  }
}

/** Сервис, чьи логотипы разлетаются: Steam или выбранная гифт-карта (у GTA VI — пальмы с капсулы). */
const BRAND_OF_PRODUCT = {
  steam: () => 'steam',
  [CARDS_PRODUCT]: () => state.values[SERVICE_KEY],
}
const selectedBrand = () => {
  const brandId = BRAND_OF_PRODUCT[state.product.id]?.() ?? null
  return brandId && Object.hasOwn(BRANDS, brandId) ? { id: brandId, ...BRANDS[brandId] } : null
}

// Что разлетается. Три случая — родные анимации мини-приложения: звёзды, Gram (и оплата TON),
// оплата USDT. В остальных в движение звёзд подставляется логотип сервиса или значок раздела.
const syncParticles = () => {
  const brand = selectedBrand()
  const key = `${state.product.id}|${state.method}|${brand?.id ?? ''}`
  if (state.method === 'usdt') {
    hero.show({ key, animation: 'tether', color: USDT_COLOR })
  } else if (state.method === 'ton' || state.product.id === GRAM_PRODUCT) {
    hero.show({ key, animation: 'gram', color: productLook(GRAM_PRODUCT).color })
  } else if (state.product.id === STARS_PRODUCT) {
    hero.show({ key, animation: 'stars', color: productLook(STARS_PRODUCT).color })
  } else if (brand) {
    hero.show({ key, animation: 'stars', color: brand.to, glyph: heroGlyph.fromPath(brand.path) })
  } else {
    hero.show({ key, animation: 'stars', ...productLook(state.product.id) })
  }
}

// В круге — аватар получателя. Запрос уходит с паузой, чтобы не дёргать Telegram на каждую букву.
const syncAvatar = () => {
  const recipient = state.values[RECIPIENT_KEY] ?? null
  if (recipient === shownRecipient) return
  shownRecipient = recipient
  clearTimeout(avatarTimer)
  if (!recipient) {
    hero.setAvatar(null)
    return
  }
  avatarTimer = setTimeout(() => hero.setAvatar(avatarUrl(recipient)), AVATAR_DEBOUNCE_MS)
}

const syncHero = () => {
  syncParticles()
  syncAvatar()
}

// ── Оплата и кнопка ───────────────────────────────────────────────
const renderPay = () => {
  payOptionsEl.replaceChildren(
    ...state.product.methods.map((method) =>
      el(
        'button',
        {
          class: 'choice',
          type: 'button',
          role: 'radio',
          'aria-checked': String(method === state.method),
          onClick: () => {
            state = { ...state, method }
            renderPay()
          },
        },
        [
          // только значок: название — для экранных дикторов, цена — на кнопке «Оплатить»
          el('img', { class: 'pay__icon', src: METHOD_ICON[method], alt: METHOD_LABEL[method], width: '24', height: '24' }),
        ],
      ),
    ),
  )
  updateSubmit()
  submitEl.disabled = state.isBusy
  syncHero()
}

let quotedSignature = null

const requestQuote = () => {
  const signature = priceSignature()
  // поле, от которого цена не зависит (ник у звёзд), — цену не трогаем
  if (signature === quotedSignature && state.product === quotedProduct) {
    renderPay()
    return
  }
  clearTimeout(quoteTimer)
  quotedSignature = signature
  quotedProduct = state.product
  state = { ...state, quote: null }
  renderPay()
  if (!canQuote()) return
  const snapshot = state
  quoteTimer = setTimeout(async () => {
    const isStale = () => state.product !== snapshot.product || priceSignature() !== signature
    try {
      const quote = await snapshot.product.quote(snapshot.values, snapshot.optionData)
      // Пока шёл запрос, покупатель мог изменить количество — устаревшую цену не показываем.
      if (isStale()) return
      state = { ...state, quote }
      showError(null)
    } catch (error) {
      if (isStale()) return
      reportError(error)
    }
    renderPay()
  }, QUOTE_DEBOUNCE_MS)
}

// ── Поля ──────────────────────────────────────────────────────────
const SHAKE_KEYFRAMES = [
  { transform: 'none' },
  { transform: 'translateX(-0.3125rem)' },
  { transform: 'translateX(0.3125rem)' },
  { transform: 'translateX(-0.3125rem)' },
  { transform: 'translateX(0.3125rem)' },
  { transform: 'none' },
]
const SHAKE_MS = 420
const prefersLessMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** Вздрагивание поля с ошибкой — заново при каждом нажатии «Оплатить». */
const shake = (node) => {
  if (!node || prefersLessMotion.matches) return
  // ник и количество в одной строке — строка вздрагивает один раз, а не дважды внахлёст
  node.getAnimations().forEach((animation) => animation.id === 'shake' && animation.cancel())
  node.animate(SHAKE_KEYFRAMES, { id: 'shake', duration: SHAKE_MS, easing: 'ease-in-out' })
}

/** Вздрагивание с вибрацией. Вибрация — одна на нажатие, даже если неверных полей несколько. */
let hapticFrame = 0
const shakeWithHaptic = (node) => {
  shake(node)
  if (hapticFrame) return
  hapticError()
  hapticFrame = requestAnimationFrame(() => {
    hapticFrame = 0
  })
}

const markInvalid = (field, message) => {
  const control = controls[field.key]
  control.wrapper.classList.toggle('field--invalid', Boolean(message))
  control.hint.textContent = message ?? ''
  control.hint.hidden = !message
  if (message) shakeWithHaptic(control.wrapper.closest('.field__control') ?? control.wrapper.querySelector('.choices'))
}

const setValue = (field, raw, data) => {
  const value = normalizeValue(field, raw)
  const isValid = field.validate ? !field.validate(raw) : value !== null && value !== undefined && value !== ''
  const dependents = state.product.fields.filter((other) => other.dependsOn?.includes(field.key))
  const cleared = Object.fromEntries(dependents.map((other) => [other.key, undefined]))
  state = {
    ...state,
    values: { ...state.values, ...cleared, [field.key]: isValid ? value : undefined },
    optionData: { ...state.optionData, ...cleared, [field.key]: data },
  }
  if (isValid) markInvalid(field, null)
  showError(null)
  syncPresets(field.key)
  dependents.forEach((other) => controls[other.key].reload())
  requestQuote()
}

/** Шаблон отмечен выбранным, когда число в поле совпадает с ним — нажали шаблон или набрали то же число. */
const syncPresets = (key) => {
  const value = state.values[key]
  fieldsEl.querySelectorAll(`[data-preset-for="${key}"]`).forEach((button) => {
    button.setAttribute('aria-pressed', String(value !== undefined && String(value) === button.dataset.value))
  })
}

const fieldMessage = (field, raw) => (field.validate ? field.validate(raw) : (field.error ?? 'Выберите вариант'))

/** Ячейка большой строки ввода и кнопки-шаблоны под ней. Подписи нет — её заменяет подсказка в поле. */
const inputField = (field) => {
  const isNumber = field.type === 'number'
  const input = el('input', {
    class: `field__input${isNumber ? ' field__input--amount' : ''}`,
    id: `field-${field.key}`,
    name: field.key,
    type: 'text',
    inputmode: isNumber ? 'numeric' : undefined,
    placeholder: field.placeholder,
    'aria-label': field.label,
    autocomplete: field.autocomplete ?? 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    onInput: () => {
      // «@» уже нарисована перед полем — вставленную вместе с ником убираем.
      if (field.prefix && input.value.startsWith(field.prefix)) input.value = input.value.slice(field.prefix.length)
      setValue(field, input.value)
    },
    // Количество: при нажатии на поле прежнее число убирается и видна подсказка («1–100»),
    // можно сразу набирать новое. Ушли, ничего не набрав, — прежнее число возвращается.
    onFocus: () => {
      if (!isNumber || !input.value) return
      input.dataset.previous = input.value
      input.value = ''
    },
    onBlur: () => {
      if (isNumber && input.value === '' && input.dataset.previous) input.value = input.dataset.previous
      delete input.dataset.previous
      if (input.value && state.values[field.key] === undefined) markInvalid(field, fieldMessage(field, input.value))
    },
  })
  const presets = (field.presets ?? []).map((preset, index) =>
    appear(el(
      'button',
      {
        class: 'choice choice--preset',
        type: 'button',
        'aria-pressed': 'false',
        'data-preset-for': field.key,
        'data-value': String(preset.value),
        onClick: () => {
          input.value = groupThousands(preset.value)
          setValue(field, input.value)
        },
      },
      [
        preset.icon && el('img', { class: 'preset-icon', src: preset.icon, alt: '', width: '24', height: '24' }),
        el('span', { text: groupThousands(preset.value) }),
      ],
    ), index + 1), // шаблоны — следом за строкой ввода
  )
  return {
    cell: el('span', { class: `field__cell${isNumber ? ' field__cell--amount' : ''}` }, [
      field.prefix && el('span', { class: 'field__prefix', text: field.prefix }),
      input,
      field.suffix && el('span', { class: 'field__suffix', text: field.suffix }),
      field.unitIcon && el('img', { class: 'field__unit', src: field.unitIcon, alt: '', width: '28', height: '28' }),
    ]),
    presets: presets.length > 0 ? el('div', { class: 'choices' }, presets) : null,
  }
}

const optionButton = (field, option, group) => {
  const button = el(
    'button',
    {
      class: `choice${field.variant ? ` choice--${field.variant}` : ''}${option.accent ? ' choice--accent' : ''}`,
      type: 'button',
      role: 'radio',
      'aria-checked': 'false',
      disabled: option.disabled,
      onClick: () => {
        group.querySelectorAll('[role="radio"]').forEach((other) => other.setAttribute('aria-checked', 'false'))
        button.setAttribute('aria-checked', 'true')
        setValue(field, option.value, option.data)
        if (field.hasPreview) {
          if (option.preview) giftPreview?.showMedia(option.preview)
          else giftPreview?.show({ id: option.value, emoji: option.label })
        }
      },
    },
    [
      option.flag && flagImage(option.flag),
      option.icon && el('img', { class: 'preset-icon', src: option.icon, alt: '', width: '24', height: '24' }),
      option.logo && logoIcon(option.logo, 'choice__logo'),
      el('span', { text: option.label }),
      option.sub && el('span', { class: 'pay__price', text: option.sub }),
    ],
  )
  return button
}

/** Порядковый номер капсулы для лёгкого появления «волной» слева направо (стили — .choice--appear). */
const appear = (node, index) => {
  node.classList.add('choice--appear')
  node.style.setProperty('--appear-index', String(index))
  return node
}

const skeletonChoices = (field) =>
  Array.from({ length: SKELETON_COUNT }, () =>
    el('span', {
      class: `choice${field.variant ? ` choice--${field.variant}` : ''} choice--skeleton`,
      'aria-hidden': 'true',
    }),
  )

const optionsField = (field) => {
  const body = el('div', {
    class: `choices${field.variant ? ` choices--${field.variant}` : ''}`,
    role: field.type === 'select' ? undefined : 'radiogroup',
    'aria-label': field.label,
  })

  const reload = async () => {
    const deps = field.dependsOn ?? []
    // Пока новые варианты грузятся или ждут выбора выше, ряд не пустеет: прежние варианты
    // остаются приглушёнными и неактивными, а если их ещё не было — место держат невидимые заглушки.
    // Так ряд не мигает и кнопки оплаты ниже не прыгают.
    const shown = [...body.querySelectorAll('.choice:not(.choice--skeleton)')]
    // что было на экране и что выбрано — чтобы те же варианты не перерисовывать с анимацией
    // и вернуть выбор (переключили PlayStation на Xbox — Турция и 25 TL остаются выбранными)
    const shownLabels = shown.map((button) => button.textContent).join('|')
    const chosenLabel = body.querySelector('[aria-checked="true"]')?.textContent ?? null
    if (shown.length > 0) {
      // обводка выбранного остаётся, ряд бледнеет только если грузится долго (задержка — в стилях)
      body.classList.add('choices--stale')
      shown.forEach((button) => {
        button.disabled = true
      })
    } else {
      body.replaceChildren(...skeletonChoices(field))
    }
    if (deps.some((key) => state.values[key] === undefined)) return
    const snapshot = state
    pendingOptionLoads += 1
    try {
      const options = await field.options(snapshot.values)
      if (state.product !== snapshot.product || deps.some((key) => state.values[key] !== snapshot.values[key])) return
      body.classList.remove('choices--stale')
      if (options.length === 0) {
        body.replaceChildren(el('span', { class: 'field__hint', text: 'Сейчас нет в наличии' }))
      } else if (field.type === 'select') {
        const select = el(
          'select',
          {
            class: 'field__input',
            id: `field-${field.key}`,
            onChange: () =>
              setValue(field, select.value, options.find((option) => String(option.value) === select.value)?.data),
          },
          [
            el('option', { value: '', text: field.placeholder }),
            ...options.map((option) => el('option', { value: option.value, text: option.label })),
          ],
        )
        body.replaceChildren(el('div', { class: 'field__control' }, [select]))
      } else {
        const buttons = options.map((option) => optionButton(field, option, body))
        const isSameSet = buttons.map((button) => button.textContent).join('|') === shownLabels
        // те же варианты встают на место молча; новые — с лёгким появлением
        body.replaceChildren(...(isSameSet ? buttons : buttons.map((button, index) => appear(button, index))))
        const again = buttons.find((button) => button.textContent === chosenLabel && !button.disabled)
        if (state.values[field.key] === undefined && again) again.click()
        // анимации выбранного варианта (подарок, коробка тарифа) — скачиваем заранее
        if (field.hasPreview) {
          const media = options.map((option) => option.preview?.animation).filter(Boolean)
          if (media.length > 0) preloadAnimations(media)
          else preloadGifts(options.map((option) => option.value))
        }
        // тестовый режим: первый вариант (срок, подарок, страна, номинал) выбран сразу
        if (CONFIG.demo && state.values[field.key] === undefined) {
          body.querySelector('[role="radio"]:not(:disabled)')?.click()
        }
      }
    } catch (error) {
      if (state.product !== snapshot.product) return
      body.classList.remove('choices--stale')
      body.replaceChildren(el('span', { class: 'field__hint', text: errorText(error) }))
    } finally {
      pendingOptionLoads -= 1
      // варианты пришли и ничего не выбрано — на кнопке подсказка, что выбрать
      if (state) updateSubmit()
    }
  }

  return { nodes: [body], reload }
}

// Поля ввода, идущие подряд, собираются в одну большую строку (получатель слева, количество справа);
// шаблоны и ошибки встают сразу под ней. Видимых подписей нет — они остаются для экранных дикторов.
const buildFields = () => {
  controls = {}
  const nodes = []
  let combo = null
  state.product.fields.forEach((field) => {
    const hint = el('span', { class: 'field__hint', hidden: true })
    if (field.type === 'text' || field.type === 'number') {
      const { cell, presets } = inputField(field)
      if (!combo) {
        // строка ввода появляется так же, как ряды капсул: всплывает и проявляется
        const control = appear(el('div', { class: 'field__control' }), 0)
        combo = { control, wrapper: el('div', { class: 'field field--combo' }, [control]) }
        nodes.push(combo.wrapper)
      }
      combo.control.append(cell)
      combo.wrapper.append(...[presets, hint].filter(Boolean))
      controls[field.key] = { wrapper: cell, hint, reload: () => {} }
      return
    }
    combo = null
    const built = field.isHidden ? { nodes: [], reload: () => {} } : optionsField(field)
    const label = el('span', { class: 'sr-only', text: field.label })
    const wrapper = el('div', { class: 'field', hidden: field.isHidden }, [label, ...built.nodes, hint])
    controls[field.key] = { wrapper, hint, reload: built.reload }
    nodes.push(wrapper)
  })
  giftPreview?.clear()
  giftPreview = null
  const firstControl = nodes[0]?.querySelector('.field__control')
  if (firstControl && state.product.fields.some((field) => field.hasPreview)) {
    const slot = el('span', { class: 'gift-preview', 'aria-hidden': 'true' })
    firstControl.append(slot)
    giftPreview = createGiftPreview(slot)
  }
  fieldsEl.replaceChildren(...nodes)
  state.product.fields.forEach((field) => controls[field.key].reload())
}

// Тестовый режим: ник, логин и количество уже заполнены — можно сразу жать «Оплатить»
// (первые варианты в рядах выбирает optionsField).
// Ник и логин — публичные тестовые, количество — первый шаблон раздела.

const TEST_VALUES = { recipient: 'durov', account: 'test_login' }

const prefillTestValues = () => {
  state.product.fields.forEach((field) => {
    const input = document.getElementById(`field-${field.key}`)
    if (!(input instanceof HTMLInputElement)) return
    const value = TEST_VALUES[field.key] ?? (field.presets?.length ? groupThousands(field.presets[0].value) : null)
    if (value === null) return
    input.value = value
    setValue(field, value)
  })
}

const centerCapsule = (button) => {
  const target = button.offsetLeft - (productsEl.clientWidth - button.offsetWidth) / 2
  productsEl.scrollTo({ left: target, behavior: 'smooth' })
}

/**
 * @param {string} productId
 * @param {string} [service] сервис гифт-карты — выбран капсулой, в форме его нет
 */
const selectProduct = (productId, service) => {
  clearTimeout(quoteTimer)
  const isSameForm = Boolean(service) && state?.product.id === productId
  const product = PRODUCTS[productId]
  const values = service ? { [SERVICE_KEY]: service } : {}
  quotedSignature = null // новый раздел — цену считаем заново
  state = { product, values, optionData: {}, method: product.methods[0], quote: null, isBusy: false }
  const active = capsule(productId, service)
  productsEl.querySelectorAll('[data-product]').forEach((button) => {
    button.setAttribute('aria-checked', String(button === active))
  })
  // Строка разделов листается: выбранная капсула должна быть видна целиком.
  if (active) centerCapsule(active)
  // цвет раздела — для тихой подсветки выбранных вариантов в форме (стили — --section-color)
  if (active) setSectionColor(getComputedStyle(active).getPropertyValue('--product-color').trim())
  showError(null)
  if (isSameForm) {
    // Гифт-карты: другой сервис — та же форма. Ряды не пересоздаются, а перезагружаются на месте:
    // страны и номиналы прежнего сервиса видны, пока не придут новые.
    state.product.fields.forEach((field) => {
      markInvalid(field, null)
      controls[field.key].reload()
    })
  } else {
    buildFields()
  }
  renderPay()
  if (CONFIG.demo) prefillTestValues()
}

const brandCapsule = (service) => {
  const button = el(
    'button',
    {
      class: 'product',
      type: 'button',
      role: 'radio',
      'aria-checked': 'false',
      'data-product': CARDS_PRODUCT,
      'data-service': service.id,
      disabled: !service.isAvailable,
    },
    [service.brand && logoIcon(service.brand.path, 'product__icon'), el('span', { text: service.label })],
  )
  // свой цвет значка у бренда (PlayStation, App Store) — без высветления, иначе синий выходит блёклым
  if (service.brand) {
    button.style.setProperty('--product-color', service.brand.icon ?? mixHex(service.brand.to, '#ffffff', BRAND_ICON_LIFT))
  }
  return button
}

/** Дописывает в строку разделов по капсуле на каждый сервис гифт-карт из каталога. */
const addCardCapsules = async () => {
  try {
    const services = await loadCardServices()
    productsEl.append(...services.map(brandCapsule))
  } catch (error) {
    // Каталог гифт-карт недоступен — остальные разделы работают, капсул сервисов просто нет.
    if (!(error instanceof ApiError)) console.error(error)
  }
}

// ── Заказ ─────────────────────────────────────────────────────────
const setFormVisible = (isVisible) => {
  productsEl.hidden = !isVisible
  form.hidden = !isVisible
  titleEl.hidden = !isVisible
}

const openStatus = (order) => {
  setFormVisible(false)
  showStatus(statusEl, order, () => {
    setFormVisible(true)
    const service = order.summary?.brand
    if (order.productId === CARDS_PRODUCT && !capsule(CARDS_PRODUCT, service)) selectProduct(DEFAULT_PRODUCT)
    else selectProduct(order.productId, order.productId === CARDS_PRODUCT ? service : undefined)
  })
}

// Тестовый режим: вместо платёжки — окно тестовой оплаты, где выбирается исход заказа.
// Заказ не сохраняется: после перезагрузки тестовой страницы восстанавливать нечего.
const payInTestMode = async (order) => {
  const activeCapsule = productsEl.querySelector('[aria-checked="true"]')
  const outcome = await askTestPayment({
    title: order.summary?.line ? `${activeCapsule?.textContent.trim() ?? ''} · ${order.summary.line}` : (activeCapsule?.textContent.trim() ?? ''),
    priceText: state.quote?.[state.method] ?? '',
    rubText: state.quote?.sbp ?? '',
  })
  state = { ...state, isBusy: false }
  renderPay()
  if (!outcome) return
  settleDemoOrder(order.ref.orderId, outcome)
  // билеты розыгрыша — только за выданные звёзды, как в боте (строку о них рисует экран статуса)
  if (outcome === 'success' && order.productId === STARS_PRODUCT) addTicketsForStars(state.values.amount)
  openStatus({ ...order, testOutcome: outcome })
}

const submit = async (event) => {
  event.preventDefault()
  if (state.isBusy) return
  const missing = state.product.fields.filter((field) => state.values[field.key] === undefined)
  if (missing.length > 0) {
    missing.forEach((field) => {
      // подсказываем только то, что уже можно заполнить: скрытые поля и ждущие выбора выше — пропускаем
      const isWaiting = (field.dependsOn ?? []).some((key) => state.values[key] === undefined)
      if (!field.isHidden && !isWaiting) markInvalid(field, field.error ?? field.validate?.('') ?? 'Выберите вариант')
    })
    return
  }
  state = { ...state, isBusy: true }
  renderPay()
  try {
    const result = await state.product.order(state.values, state.method, state.optionData)
    const order = {
      ...result,
      productId: state.product.id,
      method: state.method,
      summary: state.product.summary?.(state.values, state.optionData),
      createdAt: Date.now(),
    }
    if (CONFIG.demo) {
      await payInTestMode(order)
      return
    }
    saveOrder(order)
    // СБП: уходим на страницу оплаты, платёжка вернёт покупателя на сайт.
    if (result.kind === 'redirect' && !CONFIG.demo && isSafeLink(result.url)) {
      window.location.assign(result.url)
      return
    }
    openStatus(order)
  } catch (error) {
    reportError(error)
  }
  state = { ...state, isBusy: false }
  renderPay()
}

// На телефоне браузер при нажатии на поле сам прокручивает страницу к нему — форма «улетает».
// Поля здесь и так видны над клавиатурой, поэтому фокус ставим сами, без прокрутки.
const keepFormInPlace = () => {
  let touchStart = null
  form.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.changedTouches[0]
      touchStart = { x: touch.clientX, y: touch.clientY }
    },
    { passive: true },
  )
  form.addEventListener('touchend', (event) => {
    const input = event.target.closest('input')
    if (!input || document.activeElement === input || !touchStart) return
    const touch = event.changedTouches[0]
    // палец сдвинулся — это прокрутка, а не нажатие
    if (Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > TAP_SLOP_PX) return
    event.preventDefault()
    input.focus({ preventScroll: true })
  })
}

const init = () => {
  productsEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-product]')
    if (button && button.getAttribute('aria-checked') !== 'true') {
      selectProduct(button.dataset.product, button.dataset.service)
    }
  })
  form.addEventListener('submit', submit)
  if (CONFIG.demo) {
    mountBalance(noteEl)
    // розыгрыш NFT пока скрыт с главного экрана (готовый модуль — raffle.js); вернуть — раскомментировать
    // mountRaffle(submitEl, () => selectProduct(STARS_PRODUCT))
  }
  keepFormInPlace()

  // Платёжка возвращает с ?shop=…&order=… — сам заказ лежит в хранилище, адрес чистим.
  const params = new URLSearchParams(window.location.search)
  if (params.has('order')) {
    params.delete('order')
    params.delete('shop')
    const query = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''))
  }

  selectProduct(DEFAULT_PRODUCT)
  addCardCapsules()
  // Открыли ссылку на подаренную карту — показываем её, а не магазин и не свой заказ.
  const gift = readGiftLink(window.location.hash)
  if (gift) {
    openGift(gift)
    return
  }
  const pendingOrder = loadOrder()
  if (pendingOrder) openStatus(pendingOrder)
}

const openGift = (gift) => {
  setFormVisible(false)
  showGift(statusEl, gift, () => {
    // код из адреса убираем: дальше это обычный магазин
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setFormVisible(true)
  })
}

ensureFreshBuild()
initTelegram()
init()
