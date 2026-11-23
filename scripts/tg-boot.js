// Обычный (не модульный) скрипт в <head>, работает до первой отрисовки.
// Внутри Telegram сразу включает режим мини-приложения (класс is-telegram прячет шапку сайта,
// которую иначе накрыли бы кнопки Telegram) и синхронно подключает скрипт Telegram —
// копию на нашем сайте: telegram.org с телефона часто грузится медленно.
// Обычным посетителям сайта ничего из этого не нужно.
if (/(^#|&)tgWebApp(Data|Version|Platform)=/.test(window.location.hash)) {
  document.documentElement.classList.add('is-telegram')
  document.write('<script src="scripts/vendor/telegram-web-app.js?v=1795419966"><\/script>')
}
