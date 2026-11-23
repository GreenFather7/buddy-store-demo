// «Поделиться» гифт-картой: картинка карты (как на экране — фирменный градиент, логотип,
// номинал, регион и код) плюс ссылка, по которой получатель откроет карту с кнопкой
// «Скопировать код». Картинка рисуется заранее, как только код готов: браузер разрешает
// открыть окно «Поделиться» только сразу по нажатию, ждать отрисовку там нельзя.

import { BRANDS } from './brands.js?v=1795439404'
import { flagUrl } from './lib.js?v=1795439404'
import { mixHex } from './hero-math.js?v=1795439404'

const WIDTH = 1200
const HEIGHT = 760
const PAD = 72
const SHARE_URL = 'https://t.me/share/url'
/** JPEG вместо PNG: градиент в PNG весит ~800 КБ, в JPEG — в разы меньше, на вид так же. */
const JPEG_QUALITY = 0.9

/** Тёмные фирменные цвета (Roblox, Steam) на тёмной карте не видны — у них логотип белый. */
const WHITE_LOGO_BRANDS = ['roblox', 'steam']
const LOGO_LIFT = 0.15
export const logoColor = (brandId) =>
  WHITE_LOGO_BRANDS.includes(brandId) ? '#ffffff' : mixHex(BRANDS[brandId].to, '#ffffff', LOGO_LIFT)

const FONTS = ['700 52px Unbounded', '700 52px Inter', '600 34px Inter']
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const loadImage = (src) =>
  new Promise((resolve) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => resolve(null))
    image.src = src
  })

/** Логотип сервиса из контура 24×24. */
const drawLogo = (ctx, brand, x, y, size, color) => {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.fillStyle = color
  ctx.fill(new Path2D(brand.path))
  ctx.restore()
}

/** Самый крупный кегль (не больше max), при котором текст помещается в ширину. */
const fitFont = (ctx, text, max, width, family) => {
  let size = max
  ctx.font = `700 ${size}px ${family}`
  while (size > 24 && ctx.measureText(text).width > width) {
    size -= 2
    ctx.font = `700 ${size}px ${family}`
  }
  return size
}

const drawBackground = (ctx, brand) => {
  const base = ctx.createLinearGradient(0, 0, WIDTH * 0.35, HEIGHT)
  base.addColorStop(0.2, '#16171d')
  base.addColorStop(1, mixHex(brand.from, '#0e0f14', 0.55))
  ctx.fillStyle = base
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  const glow = ctx.createRadialGradient(WIDTH, 0, 0, WIDTH, 0, WIDTH * 0.95)
  glow.addColorStop(0, `${brand.to}99`)
  glow.addColorStop(0.62, `${brand.to}00`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  // логотип-водяной знак в правом нижнем углу, как на карте на экране
  drawLogo(ctx, brand, WIDTH * 0.46, HEIGHT * 0.3, WIDTH * 0.62, 'rgba(255,255,255,0.07)')
}

const drawHead = async (ctx, gift, brand) => {
  const logo = 88
  drawLogo(ctx, brand, PAD, PAD, logo, logoColor(gift.brand))
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = '700 52px Inter'
  ctx.fillText(brand.label, PAD + logo + 24, PAD + logo / 2)

  ctx.textAlign = 'right'
  ctx.font = '700 60px Unbounded'
  ctx.fillText(gift.nominal, WIDTH - PAD, PAD + 30)
  if (!gift.region) return
  ctx.font = '600 34px Inter'
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  const regionY = PAD + 96
  ctx.fillText(gift.region, WIDTH - PAD, regionY)
  const flagSrc = flagUrl(gift.regionCode)
  const flag = flagSrc && (await loadImage(flagSrc))
  if (!flag) return
  const flagSize = 38
  const flagX = WIDTH - PAD - ctx.measureText(gift.region).width - 14 - flagSize
  ctx.save()
  ctx.beginPath()
  ctx.arc(flagX + flagSize / 2, regionY, flagSize / 2, 0, Math.PI * 2)
  ctx.clip()
  ctx.drawImage(flag, flagX, regionY - flagSize / 2, flagSize, flagSize)
  ctx.restore()
}

const drawCode = (ctx, gift) => {
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = '700 26px Inter'
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px'
  const codes = gift.codes
  const lineHeight = 84
  const codesTop = HEIGHT - PAD - 70 - lineHeight * (codes.length - 1)
  ctx.fillText('КОД АКТИВАЦИИ', PAD, codesTop - 86)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px'
  ctx.fillStyle = '#ffffff'
  const size = Math.min(...codes.map((code) => fitFont(ctx, code, 72, WIDTH - PAD * 2, MONO)))
  ctx.font = `700 ${size}px ${MONO}`
  codes.forEach((code, index) => ctx.fillText(code, PAD, codesTop + index * lineHeight))
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.font = '600 28px Inter'
  ctx.fillText('Подарок из Buddy', PAD, HEIGHT - PAD + 8)
}

/**
 * Картинка карты (JPEG).
 * @param {import('./gift-link.js').Gift} gift
 * @returns {Promise<File|null>} null — браузер не умеет рисовать или сохранять картинку
 */
export const renderGiftImage = async (gift) => {
  const brand = BRANDS[gift.brand]
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  if (!brand || !ctx) return null
  try {
    await Promise.all(FONTS.map((font) => document.fonts.load(font)))
  } catch {
    // без фирменного шрифта картинка рисуется системным
  }
  drawBackground(ctx, brand)
  await drawHead(ctx, gift, brand)
  drawCode(ctx, gift)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) return null
  const name = `buddy-${brand.label.toLowerCase().replace(/\s+/g, '-')}.jpg`
  return new File([blob], name, { type: 'image/jpeg' })
}

const TELEGRAM_SHARE_VERSION = '8.0'
const SHARE_PATH = '/api/gift/share'

/** JPEG в base64 без префикса — так картинка уходит на сервер для сообщения Telegram. */
export const imageToBase64 = (image) =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1] ?? null))
    reader.addEventListener('error', () => resolve(null))
    reader.readAsDataURL(image)
  })

/** Мини-приложение в Telegram 8.0+: можно открыть его окно «Отправить сообщение». */
export const canShareInTelegram = () => {
  const app = window.Telegram?.WebApp
  return Boolean(app?.initData && typeof app.shareMessage === 'function' && app.isVersionAtLeast?.(TELEGRAM_SHARE_VERSION))
}

/**
 * Окно Telegram «Отправить сообщение»: фото карты, подпись и кнопка «Скопировать код».
 * Сообщение готовит бот на сервере (по заказу из базы, коды — оттуда же), здесь только открываем окно.
 * @param {string|number} orderId заказ гифт-карт
 * @param {string} imageBase64 картинка карты (JPEG)
 * @param {(shop: string, path: string, options: object) => Promise<{id: string}>} request запрос к бэкенду
 * @returns {Promise<boolean>} false — не получилось, пусть сработает обычный способ
 */
export const shareInTelegram = async (orderId, imageBase64, request) => {
  const app = window.Telegram.WebApp
  try {
    const { id } = await request('cards', SHARE_PATH, {
      method: 'POST',
      body: { order_id: String(orderId), image: imageBase64 },
      headers: { 'x-telegram-init-data': app.initData },
    })
    if (typeof id !== 'string' || !id) return false
    app.shareMessage(id)
    return true
  } catch (error) {
    // функция выключена на сервере (503), заказ не найден, Telegram отказал — делимся по-старому
    console.error('Не удалось подготовить сообщение Telegram', error)
    return false
  }
}

const shareText = (gift) =>
  `Дарю Gift-карту ${BRANDS[gift.brand].label} ${gift.nominal}${gift.region ? ` (${gift.region})` : ''} 🎁`

/**
 * Окно «Поделиться». Вызывать прямо в обработчике нажатия, без ожиданий перед ним.
 * Телефон: картинка + текст со ссылкой. Без картинки — текст со ссылкой. В Telegram без
 * системного окна — выбор чата Telegram. Иначе ссылка копируется в буфер.
 * @param {import('./gift-link.js').Gift} gift
 * @param {string} link ссылка на карту с кнопкой «Скопировать код»
 * @param {File|null} image
 * @returns {Promise<'shared'|'copied'|'cancelled'|'failed'>}
 */
export const shareGift = async (gift, link, image) => {
  const text = shareText(gift)
  const message = `${text}\nОткрыть и скопировать код: ${link}`
  const withImage = image && navigator.canShare?.({ files: [image] }) ? { files: [image], text: message } : null
  const plain = { title: text, text: `${text}\nОткрыть и скопировать код:`, url: link }
  const payload = withImage ?? (navigator.canShare?.(plain) !== false && navigator.share ? plain : null)
  if (payload) {
    try {
      await navigator.share(payload)
      return 'shared'
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'
      // системное окно не открылось — пробуем способы ниже
    }
  }
  const telegram = window.Telegram?.WebApp
  if (telegram?.openTelegramLink) {
    const params = new URLSearchParams({ url: link, text })
    telegram.openTelegramLink(`${SHARE_URL}?${params}`)
    return 'shared'
  }
  try {
    await navigator.clipboard.writeText(message)
    return 'copied'
  } catch {
    return 'failed'
  }
}
