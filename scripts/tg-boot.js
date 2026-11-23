// Обычный (не модульный) скрипт в <head>: внутри Telegram подключает его скрипт (копия на нашем сайте —
// telegram.org с телефона часто грузится медленно) сразу,
// синхронно, — чтобы мини-приложение развернулось на весь экран до первой отрисовки,
// а не после загрузки всего магазина. Обычным посетителям сайта он не нужен.
if (/(^#|&)tgWebApp(Data|Version|Platform)=/.test(window.location.hash)) {
  document.write('<script src="scripts/vendor/telegram-web-app.js"><\/script>')
}
