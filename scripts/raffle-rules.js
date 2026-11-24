// Окно «Как участвовать» — открывается знаком «?» на плашке розыгрыша после покупки.
// Обычный короткий текст без списков и значков. Правила — как в боте звёзд.

import { el } from './dom.js?v=1795504410'
import {
  RAFFLE_HOUR_MSK,
  RAFFLE_MIN_TICKETS,
  RAFFLE_STARS_PER_TICKET,
  rafflePrizeLink,
  rafflePrizeName,
} from './raffle.js?v=1795504410'

/**
 * Показывает разыгрываемый NFT в стандартном окне подарка Telegram (ссылка t.me/nft/…):
 * в мини-приложении Telegram открывает его у себя, на сайте ссылка уходит в Telegram.
 */
export const openRafflePrize = () => {
  const link = rafflePrizeLink()
  const telegram = window.Telegram?.WebApp
  if (telegram?.openTelegramLink) telegram.openTelegramLink(link)
  else window.open(link, '_blank', 'noopener')
}

const rulesText = () => [
  `Каждый день в ${RAFFLE_HOUR_MSK}:00 по Москве разыгрываем NFT-подарок ${rafflePrizeName()}.`,
  `За каждые ${RAFFLE_STARS_PER_TICKET} купленных звёзд — билет, за приглашённого друга — ещё один. ` +
    `Участвуют от ${RAFFLE_MIN_TICKETS} билетов за день, и чем их больше, тем выше шанс.`,
  'Подарок придёт победителю в Telegram.',
]

/** Открывает нижнее окно с правилами розыгрыша. */
export const openRaffleRules = () => {
  const close = () => {
    document.removeEventListener('keydown', onKey)
    sheet.classList.add('test-sheet--closing')
    sheet.addEventListener('animationend', () => sheet.remove(), { once: true })
  }
  const onKey = (event) => {
    if (event.key === 'Escape') close()
  }

  const ok = el('button', { class: 'btn btn--ghost draw-rules__ok', type: 'button', text: 'Понятно', onClick: close })
  const sheet = el('div', { class: 'test-sheet draw-rules', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'draw-rules-title' }, [
    el('div', { class: 'test-sheet__backdrop', onClick: close }),
    el('div', { class: 'test-sheet__panel draw-rules__panel' }, [
      el('h2', { class: 'draw-rules__title', id: 'draw-rules-title', text: 'Как участвовать' }),
      ...rulesText().map((text) => el('p', { class: 'draw-rules__text', text })),
      ok,
    ]),
  ])
  document.addEventListener('keydown', onKey)
  document.body.append(sheet)
  ok.focus({ preventScroll: true })
}
