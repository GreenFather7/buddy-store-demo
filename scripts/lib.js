// Чистые функции без DOM и сети — покрыты тестами в tests/lib.test.js.

const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/
const STEAM_LOGIN_PATTERN = /^[A-Za-z0-9_]{3,64}$/
const TON_DECIMALS = 9

const REGION_CODE_PATTERN = /^[a-z]{2}$/

/** Путь к круглому флагу страны по ISO-коду или null, если код не похож на код страны. */
export const flagUrl = (regionCode) => {
  const code = String(regionCode ?? '').trim().toLowerCase()
  return REGION_CODE_PATTERN.test(code) ? `assets/flags/${code}.svg` : null
}

export const ORDER_STATE = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  DELAYED: 'delayed',
  DONE: 'done',
  FAILED: 'failed',
})

/** Username без @ и пробелов. */
export const normalizeUsername = (raw) => String(raw ?? '').trim().replace(/^@+/, '')

export const isValidUsername = (raw) => USERNAME_PATTERN.test(normalizeUsername(raw))

const TELEGRAM_LAUNCH_PATTERN = /(^#|&)tgWebApp(Data|Version|Platform)=/

/** Telegram открывает мини-приложение с параметрами запуска в хэше адреса. */
export const isTelegramLaunch = (hash) => TELEGRAM_LAUNCH_PATTERN.test(String(hash ?? ''))

const TELEGRAM_USERPIC_BASE = 'https://t.me/i/userpic/320'

/** Адрес публичного аватара Telegram по username или null, если username некорректен. */
export const avatarUrl = (raw) =>
  isValidUsername(raw) ? `${TELEGRAM_USERPIC_BASE}/${normalizeUsername(raw)}.jpg` : null

export const isValidSteamLogin = (raw) => STEAM_LOGIN_PATTERN.test(String(raw ?? '').trim())

/** Целое в диапазоне или null, если ввод не число или вне границ. */
export const parseIntInRange = (raw, min, max) => {
  // пробелы между разрядами («1 000») допустимы — так суммы показаны на кнопках
  const text = String(raw ?? '').replace(/\s/g, '')
  if (!/^\d+$/.test(text)) return null
  const value = Number(text)
  return value >= min && value <= max ? value : null
}

const NBSP = '\u00a0'

/** 1000 → «1 000»: разряды через неразрывный пробел, чтобы число не рвалось при переносе. */
export const groupThousands = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)

export const formatRub = (value) => {
  const amount = Math.ceil(Number(value))
  if (!Number.isFinite(amount)) return ''
  return `${groupThousands(amount)}${NBSP}₽`
}

/** «1.50000» → «1.5»; не трогает целые. */
export const trimDecimals = (value) => {
  const text = String(value ?? '')
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

/** TON строкой → нанотоны строкой, без потери точности на float. */
export const tonToNano = (amountTon) => {
  const [whole, fraction = ''] = String(amountTon).trim().split('.')
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) throw new Error('Некорректная сумма TON')
  const nano = `${whole}${fraction.padEnd(TON_DECIMALS, '0').slice(0, TON_DECIMALS)}`
  return nano.replace(/^0+(?=\d)/, '')
}

/** Ссылка, которую открывает любой TON-кошелёк: адрес, сумма и комментарий уже заполнены. */
export const buildTonLink = ({ address, amountTon, memo }) =>
  `ton://transfer/${encodeURIComponent(address)}?amount=${tonToNano(amountTon)}&text=${encodeURIComponent(memo)}`

/** Статус Stars-бэкенда (/api/check_payment) → состояние заказа на сайте. */
export const mapStarsStatus = (status) => {
  if (status === 'stars_sent') return ORDER_STATE.DONE
  if (status === 'paid') return ORDER_STATE.PAID
  return ORDER_STATE.PENDING
}

/** Статус бэкенда гифт-карт (/api/check_order) → состояние заказа на сайте. */
export const mapCardsStatus = (status) => {
  switch (status) {
    case 'Success':
      return ORDER_STATE.DONE
    case 'Paid':
    case 'Processing':
      return ORDER_STATE.PAID
    case 'Stuck':
      return ORDER_STATE.DELAYED
    case 'Fail':
    case 'Declined':
    case 'Expired':
      return ORDER_STATE.FAILED
    default:
      return ORDER_STATE.PENDING
  }
}

const NOT_FOUND_TEXT = {
  steam: 'Такого аккаунта Steam нет или его нельзя пополнить',
  cards: 'Этот номинал сейчас недоступен',
}

const CONFLICT_TEXT = {
  premium: 'У получателя уже есть Premium',
  cards: 'Этот номинал только что закончился, выберите другой',
}

/** Понятный покупателю текст ошибки по HTTP-статусу ответа API. */
export const describeError = (status, productId) => {
  switch (status) {
    case 0:
      return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз'
    case 400:
    case 422:
      return 'Проверьте введённые данные'
    case 404:
      return NOT_FOUND_TEXT[productId] ?? 'Такого username в Telegram нет'
    case 409:
      return CONFLICT_TEXT[productId] ?? 'Заказ сейчас оформить нельзя'
    case 429:
      return 'Слишком много попыток. Подождите минуту'
    default:
      return 'Оплата временно недоступна. Попробуйте позже'
  }
}
