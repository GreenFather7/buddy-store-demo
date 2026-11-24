// Окно «Как участвовать» — открывается знаком «?» на плашке розыгрыша после покупки.
// Обычный короткий текст без списков и значков. Правила — как в боте звёзд.

import { el } from './dom.js?v=1795514661'
import { CONFIG } from './config.js?v=1795514661'
import {
  RAFFLE_HOUR_MSK,
  RAFFLE_MIN_TICKETS,
  RAFFLE_STARS_PER_TICKET,
  rafflePrizeLink,
} from './raffle.js?v=1795514661'

/**
 * Показывает разыгрываемый NFT в стандартном окне подарка Telegram (ссылка t.me/nft/…):
 * в мини-приложении Telegram открывает его у себя, на сайте ссылка уходит в Telegram.
 */
const openTelegram = (link) => {
  const telegram = window.Telegram?.WebApp
  if (telegram?.openTelegramLink) telegram.openTelegramLink(link)
  else window.open(link, '_blank', 'noopener')
}

export const openRafflePrize = () => openTelegram(rafflePrizeLink())

/** Канал, где каждый день публикуют итоги, — тот же, что даёт подписчикам цену ниже. */
const channelUrl = () => CONFIG.channelUrl || ''
const channelName = (url) => `@${url.replace(/^https?:\/\/t\.me\//, '').replace(/\/.*$/, '')}`

/** «Итоги каждый день в 20:00 МСК в канале @stars_buddy. Больше билетов — больше шансов.» */
const resultsLine = () => {
  const url = channelUrl()
  const when = `Итоги каждый день в ${RAFFLE_HOUR_MSK}:00 МСК`
  const tail = '. Больше билетов — больше шансов.'
  if (!url) return el('p', { class: 'draw-rules__text', text: when + tail })
  const link = el('a', {
    class: 'draw-rules__link',
    href: url,
    target: '_blank',
    rel: 'noopener',
    text: channelName(url),
    onClick: (event) => {
      event.preventDefault()
      openTelegram(url)
    },
  })
  return el('p', { class: 'draw-rules__text' }, [`${when} в канале `, link, tail])
}

/** Три шага — коротко, как инструкция. */
const STEPS = [
  `${RAFFLE_STARS_PER_TICKET} звёзд — 1 билет`,
  'Приглашённый друг — +1 билет',
  `От ${RAFFLE_MIN_TICKETS} ${RAFFLE_MIN_TICKETS === 1 ? 'билета' : 'билетов'} — вы в розыгрыше`,
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
      el('ol', { class: 'draw-rules__steps' }, STEPS.map((text) => el('li', { text }))),
      resultsLine(),
      ok,
    ]),
  ])
  document.addEventListener('keydown', onKey)
  document.body.append(sheet)
  ok.focus({ preventScroll: true })
}
