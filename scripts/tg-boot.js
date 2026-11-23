// Обычный (не модульный) скрипт в <head>, работает до первой отрисовки.

// Картинки сайта, которые не загрузились (например, страницу открыли ровно во время выкладки,
// пока хостинг обновлял файлы), один раз загружаются повторно — иначе вместо значков остаются «?».
// Слушатель стоит здесь, в <head>, чтобы поймать и картинки из самой разметки страницы.
;(() => {
  const RETRY_MS = 1500
  document.addEventListener(
    'error',
    (event) => {
      const image = event.target
      if (!(image instanceof HTMLImageElement) || image.dataset.retried) return
      const url = new URL(image.src, window.location.href)
      if (url.origin !== window.location.origin) return // аватары Telegram и прочее чужое не трогаем
      image.dataset.retried = '1'
      setTimeout(() => {
        url.searchParams.set('retry', String(Date.now()))
        image.src = url.href
      }, RETRY_MS)
    },
    true,
  )
})()

// Внутри Telegram сразу включает режим мини-приложения (класс is-telegram прячет шапку сайта,
// которую иначе накрыли бы кнопки Telegram) и синхронно подключает скрипт Telegram —
// копию на нашем сайте: telegram.org с телефона часто грузится медленно.
// Обычным посетителям сайта ничего из этого не нужно.
if (/(^#|&)tgWebApp(Data|Version|Platform)=/.test(window.location.hash)) {
  document.documentElement.classList.add('is-telegram')
  document.write('<script src="scripts/vendor/telegram-web-app.js?v=1795435815"><\/script>')

  // Мини-приложение ведёт себя как приложение: страница не приближается и не отдаляется.
  // На сайте в браузере масштаб щипком оставлен — он нужен людям со слабым зрением.
  const viewport = document.querySelector('meta[name="viewport"]')
  if (viewport) viewport.content = `${viewport.content}, maximum-scale=1, user-scalable=no`
  // iOS не всегда слушается user-scalable=no — гасим сам жест щипка
  const stopPinch = (event) => event.preventDefault()
  document.addEventListener('gesturestart', stopPinch)
  document.addEventListener('gesturechange', stopPinch)
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) event.preventDefault()
    },
    { passive: false },
  )
}
