// Адреса бэкендов и ключи. Перед выкладкой сайта проверьте все значения.

// Сборка с тестовым режимом (?demo=1, mock.js, testpay.js). Боевая сборка (tools/build-site.sh)
// ставит здесь false и подменяет тестовые модули заглушками: параметр demo там ничего не включает.
const IS_DEMO_BUILD = true

const isDemo = IS_DEMO_BUILD && new URLSearchParams(window.location.search).has('demo')

export const CONFIG = Object.freeze({
  // Бэкенд Buddy Stars (объединённый бот): звёзды, Premium, Gram, подарки.
  starsApi: 'https://stars.buddygpt.ru',
  // Бэкенд Buddy Gift Cards: Steam и гифт-карты. Адрес вместе с префиксом nginx,
  // без завершающего слеша, например 'https://example.ru/buddy_steambot'.
  cardsApi: '',
  // В Telegram покупатель входит подписью Telegram (initData), а не гостем — но только в бэкенд
  // того бота, из которого открыто мини-приложение: подпись проверяется токеном этого бота.
  // Мини-приложение открывается из объединённого бота (бэкенд starsApi).
  telegramAuth: Object.freeze({ stars: true, cards: false }),
  // Открытый ключ подписи подарков (ECDSA P-256, SPKI в base64; см. backend api/gift_sign.py).
  // Ссылку «Подарить эту карту» без верной подписи боевой сайт не показывает.
  giftPublicKey: '',
  // Канал Buddy: подписчикам звёзды дешевле (бэкенд сам проверяет подписку). Ссылка вида
  // 'https://t.me/имя_канала'; пусто — строка «Подписчикам канала — дешевле» не показывается.
  channelUrl: 'https://t.me/stars_buddy',
  // Опрос статуса заказа: часто в первую минуту, дальше реже (в тестовом режиме итог виден почти сразу).
  statusPoll: Object.freeze(
    isDemo
      ? { fastMs: 700, slowMs: 700, idleMs: 700, fastForMs: 60_000, slowForMs: 600_000, stopAfterMs: 3_600_000 }
      : { fastMs: 3000, slowMs: 10_000, idleMs: 15_000, fastForMs: 60_000, slowForMs: 600_000, stopAfterMs: 3 * 3_600_000 },
  ),
  // Проверка перевода TON (ходит в tonapi): не чаще, и не раньше, чем покупатель успеет перевести.
  tonVerify: Object.freeze({ firstAfterMs: isDemo ? 0 : 20_000, everyMs: isDemo ? 0 : 15_000 }),
  // Демо-режим без бэкенда: открыть сайт с ?demo=1 (только в демо-сборке).
  demo: isDemo,
})
