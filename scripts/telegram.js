// Запуск внутри Telegram как мини-приложение: разворачиваемся на весь экран.
// Скрипт Telegram подгружается только там — обычным посетителям сайта он не нужен.

import { isTelegramLaunch } from './lib.js?v=1795514178'

const SDK_URL = 'scripts/vendor/telegram-web-app.js?v=1795514178'
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
  // Обычно скрипт Telegram уже подключён из <head> (tg-boot.js) — разворачиваемся сразу.
  if (window.Telegram?.WebApp) {
    setUp()
    return
  }
  const script = document.createElement('script')
  script.src = SDK_URL
  script.addEventListener('load', setUp)
  // Без скрипта Telegram магазин работает как обычная страница — ошибку только фиксируем.
  script.addEventListener('error', () => console.error('Не удалось загрузить скрипт Telegram'))
  document.head.append(script)
}

const HAPTIC_MIN_VERSION = '6.1'
/** Короткая вибрация для обычного браузера на Android: два коротких толчка, как «ошибка». */
const ERROR_VIBRATION_MS = [30, 40, 30]

/**
 * Вибрация «ошибка»: в Telegram — через его тактильный отклик (работает и на iPhone),
 * в браузере — через navigator.vibrate, где он есть (Android). На iPhone в Safari вибрации нет.
 */
export const hapticError = () => {
  const app = window.Telegram?.WebApp
  if (app?.HapticFeedback && app.isVersionAtLeast?.(HAPTIC_MIN_VERSION)) {
    app.HapticFeedback.notificationOccurred('error')
    return
  }
  navigator.vibrate?.(ERROR_VIBRATION_MS)
}

/** Короткий толчок браузерной вибрации (Android) — как щелчок колёсика. */
const SELECTION_VIBRATION_MS = 8

/**
 * Лёгкий щелчок при смене раздела — как у колёсика выбора в iOS. В Telegram — его тактильный
 * отклик «выбор изменился», в браузере на Android — короткая вибрация.
 */
export const hapticSelection = () => {
  const app = window.Telegram?.WebApp
  if (app?.HapticFeedback && app.isVersionAtLeast?.(HAPTIC_MIN_VERSION)) {
    app.HapticFeedback.selectionChanged()
    return
  }
  navigator.vibrate?.(SELECTION_VIBRATION_MS)
}
