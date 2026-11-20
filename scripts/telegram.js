// Запуск внутри Telegram как мини-приложение: разворачиваемся на весь экран.
// Скрипт Telegram подгружается только там — обычным посетителям сайта он не нужен.

import { isTelegramLaunch } from './lib.js'

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js'
const APP_COLOR = '#151517'
const FULLSCREEN_MIN_VERSION = '8.0'
/** На компьютере полноэкранный режим закрывает весь монитор — включаем только на телефонах. */
const FULLSCREEN_PLATFORMS = ['ios', 'android']
const TELEGRAM_CLASS = 'is-telegram'

const setUp = () => {
  const app = window.Telegram?.WebApp
  if (!app) return
  document.documentElement.classList.add(TELEGRAM_CLASS)
  app.ready()
  app.expand()
  // Свайп вниз не должен закрывать магазин посреди заполнения формы.
  app.disableVerticalSwipes?.()
  app.setHeaderColor?.(APP_COLOR)
  app.setBackgroundColor?.(APP_COLOR)
  const canGoFullscreen =
    FULLSCREEN_PLATFORMS.includes(app.platform) &&
    app.isVersionAtLeast?.(FULLSCREEN_MIN_VERSION) &&
    typeof app.requestFullscreen === 'function' &&
    !app.isFullscreen
  if (canGoFullscreen) app.requestFullscreen()
}

export const initTelegram = () => {
  if (!isTelegramLaunch(window.location.hash)) return
  const script = document.createElement('script')
  script.src = SDK_URL
  script.addEventListener('load', setUp)
  // Без скрипта Telegram магазин работает как обычная страница — ошибку только фиксируем.
  script.addEventListener('error', () => console.error('Не удалось загрузить скрипт Telegram'))
  document.head.append(script)
}
