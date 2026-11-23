// Адреса бэкендов. Перед выкладкой сайта проверьте оба значения.
export const CONFIG = Object.freeze({
  // Бэкенд Buddy Stars: звёзды, Premium, Gram, подарки.
  starsApi: 'https://stars.buddygpt.ru',
  // Бэкенд Buddy Gift Cards: Steam и гифт-карты. Адрес вместе с префиксом nginx,
  // без завершающего слеша, например 'https://example.ru/buddy_steambot'.
  cardsApi: '',
  // Канал Buddy: подписчикам звёзды дешевле (бэкенд сам проверяет подписку). Ссылка вида
  // 'https://t.me/имя_канала'; пусто — строка «Подписчикам канала — дешевле» не показывается.
  channelUrl: 'https://t.me/stars_buddy',
  // Как часто спрашивать статус заказа после оплаты.
  // в тестовом режиме чаще: итог тестовой оплаты виден почти сразу
  statusPollMs: new URLSearchParams(window.location.search).has('demo') ? 700 : 3000,
  // Демо-режим без бэкенда: открыть сайт с ?demo=1.
  demo: new URLSearchParams(window.location.search).has('demo'),
})
