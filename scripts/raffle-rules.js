// Окно «Как устроен розыгрыш» — открывается знаком «?» на плашке розыгрыша после покупки.
// Коротко: что разыгрывается, как получить билеты, когда итоги. Правила — как в боте звёзд.

import { el } from './dom.js?v=1795504228'
import {
  RAFFLE_HOUR_MSK,
  RAFFLE_MIN_TICKETS,
  RAFFLE_STARS_PER_TICKET,
  rafflePrizeImage,
  rafflePrizeLink,
  rafflePrizeName,
} from './raffle.js?v=1795504228'

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

const RULES = [
  ['🎟', `1 билет за каждые ${RAFFLE_STARS_PER_TICKET} звёзд`],
  ['👋', '+1 билет за каждого приглашённого друга'],
  // после «от» — родительный падеж: «от 3 билетов», «от 1 билета»
  ['✅', `Участвуют от ${RAFFLE_MIN_TICKETS} ${RAFFLE_MIN_TICKETS === 1 ? 'билета' : 'билетов'} за день`],
  ['🍀', 'Больше билетов — больше шансов'],
  ['🕗', `Итоги каждый день в ${RAFFLE_HOUR_MSK}:00 по Москве, после — счёт с нуля`],
  ['🎁', 'Подарок придёт победителю в Telegram'],
]

const ruleItem = ([icon, text]) =>
  el('li', { class: 'draw-rules__item' }, [
    el('span', { class: 'draw-rules__icon', text: icon, 'aria-hidden': 'true' }),
    el('span', { text }),
  ])

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

  const sheet = el('div', { class: 'test-sheet draw-rules', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Как устроен розыгрыш' }, [
    el('div', { class: 'test-sheet__backdrop', onClick: close }),
    el('div', { class: 'test-sheet__panel draw-rules__panel' }, [
      el('button', { class: 'draw-rules__prize', type: 'button', onClick: openRafflePrize }, [
        el('img', { class: 'draw-rules__image', src: rafflePrizeImage(), alt: '', width: '64', height: '64' }),
        el('span', { class: 'draw-rules__heading' }, [
          el('strong', { text: 'Розыгрыш NFT' }),
          el('span', { class: 'draw-rules__prize-name', text: `${rafflePrizeName()} ›` }),
        ]),
      ]),
      el('ul', { class: 'draw-rules__list' }, RULES.map(ruleItem)),
      el('button', { class: 'btn btn--gold draw-rules__ok', type: 'button', text: 'Понятно', onClick: close }),
    ]),
  ])
  document.addEventListener('keydown', onKey)
  document.body.append(sheet)
  sheet.querySelector('.draw-rules__ok').focus({ preventScroll: true })
}
