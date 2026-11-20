import { ApiError } from './api.js'
import { BRANDS } from './brands.js'
import { CONFIG } from './config.js'
import { el, flagImage, isSafeLink, logoIcon } from './dom.js'
import { ensureFreshBuild } from './fresh.js'
import { createGiftPreview } from './gift-preview.js'
import { createHero, heroGlyph } from './hero.js'
import { mixHex } from './hero-math.js'
import { avatarUrl, describeError, groupThousands } from './lib.js'
import { PRODUCTS, loadCardServices, normalizeValue } from './products.js'
import { loadOrder, saveOrder, showStatus } from './status.js'
import { hapticError, initTelegram } from './telegram.js'
import { askTestPayment, mountBalance } from './testpay.js'
import { settleDemoOrder } from './mock.js'

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
const statusEl = root.querySelector('[data-status]')
const titleEl = document.querySelector('.store__title')
const hero = createHero(document.querySelector('[data-hero]'))

/** Состояние формы. Заменяется целиком при смене товара. */
let state = null
let quoteTimer = 0
let avatarTimer = 0
let shownRecipient = null
/** key → { wrapper, hint, reload } для полей текущего товара. */
let controls = {}
/** Показ выбранного подарка в строке ввода; есть только в разделе подарков. */
let giftPreview = null

/** Текст ошибки показывается на самой кнопке оплаты: под формой ничего не появляется и не сдвигается. */
let errorMessage = null

const updateSubmit = () => {
  const price = state?.quote?.[state.method]
  submitEl.classList.toggle('order__submit--error', Boolean(errorMessage))
  submitLabelEl.textContent = errorMessage ?? (price && /\d/.test(price) ? `Оплатить ${price}` : 'Оплатить')
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

// ── Шапка ─────────────────────────────────────────────────────────
/** Капсула в строке разделов: раздел или, для гифт-карт, конкретный сервис. */
const capsule = (productId, service) =>
  [...productsEl.querySelectorAll('[data-product]')].find(
    (button) => button.dataset.product === productId && (button.dataset.service ?? '') === (service ?? ''),
  )

const productButton = (productId) => capsule(productId)

const productLook = (productId) => {
  const button = productButton(productId)
  return {
    color: getComputedStyle(button).getPropertyValue('--product-color').trim(),
    glyph: heroGlyph.fromIcon(button.querySelector('svg')),
  }
}

/** Сервис, чьи логотипы разлетаются: Steam или выбранная гифт-карта. */
const selectedBrand = () => {
  const brandId =
    state.product.id === 'steam' ? 'steam' : state.product.id === CARDS_PRODUCT ? state.values[SERVICE_KEY] : null
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
          el('img', { class: 'pay__icon', src: METHOD_ICON[method], alt: '', width: '24', height: '24' }),
          // цена — только на кнопке «Оплатить»: она показывает сумму для выбранного способа
          el('span', { text: METHOD_LABEL[method] }),
        ],
      ),
    ),
  )
  updateSubmit()
  submitEl.disabled = state.isBusy
  syncHero()
}

const requestQuote = () => {
  clearTimeout(quoteTimer)
  state = { ...state, quote: null }
  renderPay()
  if (!isComplete()) return
  const snapshot = state
  quoteTimer = setTimeout(async () => {
    try {
      const quote = await snapshot.product.quote(snapshot.values, snapshot.optionData)
      // Пока шёл запрос, покупатель мог изменить форму — устаревший ответ не показываем.
      if (state.values !== snapshot.values) return
      state = { ...state, quote }
      showError(null)
    } catch (error) {
      if (state.values !== snapshot.values) return
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
  dependents.forEach((other) => controls[other.key].reload())
  requestQuote()
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
    onBlur: () => {
      if (input.value && state.values[field.key] === undefined) markInvalid(field, fieldMessage(field, input.value))
    },
  })
  const presets = (field.presets ?? []).map((preset, index) =>
    appear(el(
      'button',
      {
        class: 'choice choice--preset',
        type: 'button',
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
      class: `choice${field.variant ? ` choice--${field.variant}` : ''}`,
      type: 'button',
      role: 'radio',
      'aria-checked': 'false',
      disabled: option.disabled,
      onClick: () => {
        group.querySelectorAll('[role="radio"]').forEach((other) => other.setAttribute('aria-checked', 'false'))
        button.setAttribute('aria-checked', 'true')
        setValue(field, option.value, option.data)
        if (field.hasPreview) giftPreview?.show({ id: option.value, emoji: option.label })
      },
    },
    [
      option.flag && flagImage(option.flag),
      option.icon && el('img', { class: 'preset-icon', src: option.icon, alt: '', width: '24', height: '24' }),
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
    // Пока вариантов нет (грузятся или ждут выбора выше), ряд занят заглушками того же размера:
    // место под него не схлопывается, и кнопки оплаты ниже не прыгают.
    body.replaceChildren(...skeletonChoices(field))
    if (deps.some((key) => state.values[key] === undefined)) return
    const snapshot = state
    try {
      const options = await field.options(snapshot.values)
      if (state.product !== snapshot.product || deps.some((key) => state.values[key] !== snapshot.values[key])) return
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
        body.replaceChildren(...options.map((option, index) => appear(optionButton(field, option, body), index)))
      }
    } catch (error) {
      if (state.product !== snapshot.product) return
      body.replaceChildren(el('span', { class: 'field__hint', text: errorText(error) }))
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
  const product = PRODUCTS[productId]
  const values = service ? { [SERVICE_KEY]: service } : {}
  state = { product, values, optionData: {}, method: product.methods[0], quote: null, isBusy: false }
  const active = capsule(productId, service)
  productsEl.querySelectorAll('[data-product]').forEach((button) => {
    button.setAttribute('aria-checked', String(button === active))
  })
  // Строка разделов листается: выбранная капсула должна быть видна целиком.
  if (active) centerCapsule(active)
  showError(null)
  buildFields()
  renderPay()
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
  if (service.brand) button.style.setProperty('--product-color', mixHex(service.brand.to, '#ffffff', BRAND_ICON_LIFT))
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
    const result = await state.product.order(state.values, state.method)
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
  if (CONFIG.demo) mountBalance(submitEl)
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
  const pendingOrder = loadOrder()
  if (pendingOrder) openStatus(pendingOrder)
}

ensureFreshBuild()
initTelegram()
init()
