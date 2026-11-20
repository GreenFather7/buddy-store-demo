import { ApiError } from './api.js'
import { BRANDS } from './brands.js'
import { CONFIG } from './config.js'
import { el, flagImage, isSafeLink, logoIcon, paintBrand } from './dom.js'
import { createHero, heroGlyph } from './hero.js'
import { avatarUrl, describeError } from './lib.js'
import { PRODUCTS, normalizeValue } from './products.js'
import { loadOrder, saveOrder, showStatus } from './status.js'
import { initTelegram } from './telegram.js'

const QUOTE_DEBOUNCE_MS = 400
const AVATAR_DEBOUNCE_MS = 500
/** Поле с username получателя в разделах Telegram. */
const RECIPIENT_KEY = 'recipient'
const DEFAULT_PRODUCT = 'stars'
const METHOD_LABEL = { sbp: 'СБП', ton: 'TON', usdt: 'USDT' }
const USDT_COLOR = '#1fb5a8'
const STARS_PRODUCT = 'stars'
const GRAM_PRODUCT = 'gram'

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

const showError = (text) => {
  errorEl.textContent = text ?? ''
  errorEl.hidden = !text
}

const errorText = (error) => {
  if (!(error instanceof ApiError)) console.error(error) // ошибка в коде, а не в сети — нужна в консоли
  return describeError(error instanceof ApiError ? error.status : 0, state.product.id)
}

const isComplete = () => state.product.fields.every((field) => state.values[field.key] !== undefined)

// ── Шапка ─────────────────────────────────────────────────────────
const productButton = (productId) => productsEl.querySelector(`[data-product="${productId}"]`)

const productLook = (productId) => {
  const button = productButton(productId)
  return {
    color: getComputedStyle(button).getPropertyValue('--product-color').trim(),
    glyph: heroGlyph.fromIcon(button.querySelector('svg')),
  }
}

/** Сервис, чьи логотипы разлетаются: Steam или выбранная гифт-карта. */
const selectedBrand = () => {
  const brandId = state.product.id === 'steam' ? 'steam' : state.product.id === 'cards' ? state.values.service : null
  return brandId && Object.hasOwn(BRANDS, brandId) ? { id: brandId, ...BRANDS[brandId] } : null
}

// Что разлетается. Три случая — родные анимации мини-приложения: звёзды, Gram (и оплата TON),
// оплата USDT. В остальных в движение звёзд подставляется логотип сервиса или значок раздела.
const syncParticles = () => {
  const brand = selectedBrand()
  const key = `${state.product.id}|${state.method}|${brand?.id ?? ''}`
  const ownColor = productLook(state.product.id).color
  if (state.method === 'usdt') {
    hero.show({ key, animation: 'tether', color: USDT_COLOR })
  } else if (state.method === 'ton' || state.product.id === GRAM_PRODUCT) {
    hero.show({ key, animation: 'gram', color: productLook(GRAM_PRODUCT).color })
  } else if (state.product.id === STARS_PRODUCT) {
    hero.show({ key, animation: 'stars', color: ownColor })
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
          el('span', { text: METHOD_LABEL[method] }),
          el('span', { class: 'pay__price', text: state.quote?.[method] ?? '—' }),
        ],
      ),
    ),
  )
  const price = state.quote?.[state.method]
  submitLabelEl.textContent = price && /\d/.test(price) ? `Оплатить ${price}` : 'Оплатить'
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
      showError(errorText(error))
    }
    renderPay()
  }, QUOTE_DEBOUNCE_MS)
}

// ── Поля ──────────────────────────────────────────────────────────
const markInvalid = (field, message) => {
  const control = controls[field.key]
  control.wrapper.classList.toggle('field--invalid', Boolean(message))
  control.hint.textContent = message ?? ''
  control.hint.hidden = !message
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

const inputField = (field) => {
  const input = el('input', {
    class: 'field__input',
    id: `field-${field.key}`,
    name: field.key,
    type: 'text',
    inputmode: field.type === 'number' ? 'numeric' : undefined,
    placeholder: field.placeholder,
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
  const presets = (field.presets ?? []).map((preset) =>
    el(
      'button',
      {
        class: 'choice choice--preset',
        type: 'button',
        onClick: () => {
          input.value = String(preset.value)
          setValue(field, input.value)
        },
      },
      [
        preset.icon && el('img', { class: 'preset-icon', src: preset.icon, alt: '', width: '24', height: '24' }),
        el('span', { text: String(preset.value) }),
      ],
    ),
  )
  return [
    el('div', { class: 'field__control' }, [
      field.prefix && el('span', { class: 'field__prefix', text: field.prefix }),
      input,
      field.suffix && el('span', { class: 'field__suffix', text: field.suffix }),
    ]),
    presets.length > 0 && el('div', { class: 'choices' }, presets),
  ]
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
      },
    },
    [
      option.brand && logoIcon(option.brand.path, 'brand-logo'),
      option.flag && flagImage(option.flag),
      option.icon && el('img', { class: 'preset-icon', src: option.icon, alt: '', width: '24', height: '24' }),
      el('span', { class: option.brand ? 'brand-label' : undefined, text: option.label }),
      option.sub && el('span', { class: 'pay__price', text: option.sub }),
    ],
  )
  return option.brand ? paintBrand(button, option.brand) : button
}

const optionsField = (field) => {
  const body = el('div', {
    class: `choices${field.variant ? ` choices--${field.variant}` : ''}`,
    role: field.type === 'select' ? undefined : 'radiogroup',
    'aria-label': field.label,
  })

  const reload = async () => {
    const deps = field.dependsOn ?? []
    if (deps.some((key) => state.values[key] === undefined)) {
      body.replaceChildren()
      controls[field.key].wrapper.hidden = true
      return
    }
    controls[field.key].wrapper.hidden = false
    body.replaceChildren(el('span', { class: 'field__hint', text: 'Загружаем…' }))
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
        body.replaceChildren(...options.map((option) => optionButton(field, option, body)))
      }
    } catch (error) {
      if (state.product !== snapshot.product) return
      body.replaceChildren(el('span', { class: 'field__hint', text: errorText(error) }))
    }
  }

  return { nodes: [body], reload }
}

const buildFields = () => {
  controls = {}
  const nodes = state.product.fields.map((field) => {
    const isInput = field.type === 'text' || field.type === 'number'
    const built = isInput ? { nodes: inputField(field), reload: () => {} } : optionsField(field)
    const hint = el('span', { class: 'field__hint', hidden: true })
    const label = isInput
      ? el('label', { class: 'field__label', for: `field-${field.key}`, text: field.label })
      : el('span', { class: 'field__label', text: field.label })
    const wrapper = el('div', { class: 'field' }, [label, ...built.nodes, hint])
    controls[field.key] = { wrapper, hint, reload: built.reload }
    return wrapper
  })
  fieldsEl.replaceChildren(...nodes)
  state.product.fields.forEach((field) => controls[field.key].reload())
}

const centerProduct = (productId) => {
  const button = productButton(productId)
  const target = button.offsetLeft - (productsEl.clientWidth - button.offsetWidth) / 2
  productsEl.scrollTo({ left: target, behavior: 'smooth' })
}

const selectProduct = (productId) => {
  clearTimeout(quoteTimer)
  const product = PRODUCTS[productId]
  state = { product, values: {}, optionData: {}, method: product.methods[0], quote: null, isBusy: false }
  productsEl.querySelectorAll('[data-product]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.product === productId))
  })
  // Строка разделов листается: выбранная капсула должна быть видна целиком.
  centerProduct(productId)
  showError(null)
  buildFields()
  renderPay()
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
    selectProduct(order.productId)
  })
}

const submit = async (event) => {
  event.preventDefault()
  if (state.isBusy) return
  const missing = state.product.fields.filter((field) => state.values[field.key] === undefined)
  if (missing.length > 0) {
    missing.forEach((field) => {
      if (!controls[field.key].wrapper.hidden) markInvalid(field, field.error ?? field.validate?.('') ?? 'Выберите вариант')
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
    saveOrder(order)
    // СБП: уходим на страницу оплаты, платёжка вернёт покупателя на сайт.
    if (result.kind === 'redirect' && !CONFIG.demo && isSafeLink(result.url)) {
      window.location.assign(result.url)
      return
    }
    openStatus(order)
  } catch (error) {
    showError(errorText(error))
  }
  state = { ...state, isBusy: false }
  renderPay()
}

const init = () => {
  productsEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-product]')
    if (button && button.dataset.product !== state.product.id) selectProduct(button.dataset.product)
  })
  form.addEventListener('submit', submit)

  // Платёжка возвращает с ?shop=…&order=… — сам заказ лежит в хранилище, адрес чистим.
  const params = new URLSearchParams(window.location.search)
  if (params.has('order')) {
    params.delete('order')
    params.delete('shop')
    const query = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''))
  }

  selectProduct(DEFAULT_PRODUCT)
  const pendingOrder = loadOrder()
  if (pendingOrder) openStatus(pendingOrder)
}

initTelegram()
init()
