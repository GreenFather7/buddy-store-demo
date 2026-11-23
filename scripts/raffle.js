// Ежедневный розыгрыш NFT-подарка, как в боте звёзд: 1 билет за каждые 50 звёзд,
// розыгрыш в 20:00, участвуют от 3 билетов, приз приходит в Telegram.
// Пока у бэкенда нет метода для сайта, данные розыгрыша есть только в тестовом режиме:
// приз — мишка из анимаций мини-приложения, билеты копятся за тестовые покупки звёзд.

import { el } from './dom.js?v=1795420778'
import { playLottie } from './gift-preview.js?v=1795420778'

const RAFFLE_HOUR = 20
const STARS_PER_TICKET = 50
const MIN_TICKETS = 3
const TICKETS_KEY = 'buddy.test.tickets'
const CLOCK_TICK_MS = 1000
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60

/**
 * Приз в тестовом режиме — NFT Plush Pepe #1. Картинка и анимация взяты с Fragment
 * (nft.fragment.com/gift/plushpepe-1.medium.jpg и .lottie.json), откуда бот берёт превью приза.
 * Настоящий приз придёт из состояния розыгрыша на бэкенде (raffle_state.gift_url).
 */
const DEMO_PRIZE = {
  title: 'Plush Pepe',
  number: '#1',
  link: 'https://t.me/nft/PlushPepe-1',
  image: 'assets/raffle/plushpepe-1.jpg',
  animation: 'assets/raffle/plushpepe-1.json',
}

/** До какого момента идёт текущий розыгрыш (ближайшие 20:00). */
const nextDraw = (now = new Date()) => {
  const draw = new Date(now)
  draw.setHours(RAFFLE_HOUR, 0, 0, 0)
  if (now >= draw) draw.setDate(draw.getDate() + 1)
  return draw
}

const pad = (value) => String(value).padStart(2, '0')

const countdown = () => {
  const totalSeconds = Math.max(0, Math.floor((nextDraw() - Date.now()) / MS_PER_SECOND))
  const hours = Math.floor(totalSeconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR))
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/** «1 билет», «3 билета», «5 билетов». */
export const ticketsWord = (count) => {
  const tens = count % 100
  const units = count % 10
  if (tens >= 11 && tens <= 19) return 'билетов'
  if (units === 1) return 'билет'
  if (units >= 2 && units <= 4) return 'билета'
  return 'билетов'
}

/** Билеты привязаны к дню розыгрыша: после 20:00 начинается новый день и счёт с нуля. */
const drawKey = () => nextDraw().toDateString()

let memoryTickets = { day: drawKey(), count: 0 }

const readTickets = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(TICKETS_KEY) ?? 'null')
    memoryTickets = stored ?? memoryTickets
  } catch {
    // без хранилища считаем в памяти
  }
  return memoryTickets.day === drawKey() ? memoryTickets.count : 0
}

const writeTickets = (count) => {
  memoryTickets = { day: drawKey(), count }
  try {
    localStorage.setItem(TICKETS_KEY, JSON.stringify(memoryTickets))
  } catch {
    // без хранилища билеты живут до перезагрузки
  }
  document.dispatchEvent(new CustomEvent('rafflechange'))
}

/** Сколько билетов даст покупка звёзд. */
export const ticketsFor = (stars) => Math.floor(Number(stars) / STARS_PER_TICKET) || 0

/** Начисляет билеты за купленные звёзды; возвращает, сколько добавилось. */
export const addTicketsForStars = (stars) => {
  const added = ticketsFor(stars)
  if (added > 0) writeTickets(readTickets() + added)
  return added
}

const ticketsLine = (count) =>
  count >= MIN_TICKETS
    ? `Вы участвуете · ${count} ${ticketsWord(count)}`
    : `${count} из ${MIN_TICKETS} ${ticketsWord(MIN_TICKETS)} для участия`

/**
 * Окно розыгрыша: приз с анимацией, таймер, ваши билеты и правила.
 * @param {() => void} onBuyStars перейти к покупке звёзд
 */
const openSheet = (onBuyStars) => {
  const tickets = readTickets()
  const clock = el('span', { class: 'raffle-sheet__clock', text: countdown() })
  const timer = setInterval(() => {
    clock.textContent = countdown()
  }, CLOCK_TICK_MS)

  // сначала картинка, поверх неё запускается анимация NFT — как карточка подарка в Telegram
  const prizeImage = el('img', { class: 'raffle-sheet__image', src: DEMO_PRIZE.image, alt: '', width: '144', height: '144' })
  const prizeStage = el('span', { class: 'raffle-sheet__lottie' })
  const prize = el('a', {
    class: 'raffle-sheet__prize',
    href: DEMO_PRIZE.link,
    target: '_blank',
    rel: 'noopener',
    'aria-label': `${DEMO_PRIZE.title} ${DEMO_PRIZE.number} в Telegram`,
  }, [prizeImage, prizeStage])
  let animation = null
  playLottie(prizeStage, DEMO_PRIZE.animation).then((played) => {
    animation = played
    if (played) prize.classList.add('raffle-sheet__prize--playing')
  })


  const close = () => {
    clearInterval(timer)
    animation?.destroy()
    document.removeEventListener('keydown', onKey)
    sheet.classList.add('test-sheet--closing')
    sheet.addEventListener('animationend', () => sheet.remove(), { once: true })
  }
  const onKey = (event) => {
    if (event.key === 'Escape') close()
  }

  // Только нужное: приз, когда розыгрыш, сколько у вас билетов и как получить ещё.
  const sheet = el('div', { class: 'test-sheet raffle-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Розыгрыш NFT' }, [
    el('div', { class: 'test-sheet__backdrop', onClick: close }),
    el('div', { class: 'test-sheet__panel raffle-sheet__panel' }, [
      el('div', { class: 'raffle-sheet__stage' }, [el('span', { class: 'raffle-sheet__glow' }), prize]),
      el('p', { class: 'raffle-sheet__title' }, [
        DEMO_PRIZE.title,
        el('span', { class: 'raffle-sheet__number', text: ` ${DEMO_PRIZE.number}` }),
      ]),
      el('p', { class: 'raffle-sheet__when' }, [el('span', { text: 'Розыгрыш через ' }), clock]),
      el('p', {
        class: `raffle-sheet__tickets${tickets >= MIN_TICKETS ? ' raffle-sheet__tickets--in' : ''}`,
        text: `🎟 ${ticketsLine(tickets)}`,
      }),
      el('button', {
        class: 'btn btn--gold test-sheet__option raffle-sheet__buy',
        type: 'button',
        onClick: () => {
          close()
          onBuyStars()
        },
      }, [el('span', { text: 'Купить звёзды' }), el('small', { text: `1 билет за ${STARS_PER_TICKET} звёзд` })]),
    ]),
  ])
  document.addEventListener('keydown', onKey)
  document.body.append(sheet)
}

/**
 * Карточка розыгрыша под кнопкой оплаты: приз, таймер и ваши билеты; нажатие открывает окно.
 * @param {HTMLElement} anchor после какого элемента поставить карточку
 * @param {() => void} onBuyStars
 */
export const mountRaffle = (anchor, onBuyStars) => {
  const prize = el('img', { class: 'raffle-card__prize', src: DEMO_PRIZE.image, alt: '', width: '44', height: '44' })
  const clock = el('span', { class: 'raffle-card__clock' })
  const tickets = el('span', { class: 'raffle-card__tickets' })
  const card = el(
    'button',
    { class: 'raffle-card', type: 'button', onClick: () => openSheet(onBuyStars) },
    [
      prize,
      el('span', { class: 'raffle-card__text' }, [
        el('strong', { text: `Розыгрыш ${DEMO_PRIZE.title} ${DEMO_PRIZE.number}` }),
        el('span', { class: 'raffle-card__meta' }, [clock, tickets]),
      ]),
      el('span', { class: 'raffle-card__arrow', text: '›', 'aria-hidden': 'true' }),
    ],
  )
  const update = () => {
    clock.textContent = `через ${countdown()}`
    const count = readTickets()
    tickets.textContent = `🎟 ${count}`
    card.classList.toggle('raffle-card--in', count >= MIN_TICKETS)
  }
  update()
  setInterval(update, CLOCK_TICK_MS)
  document.addEventListener('rafflechange', update)
  anchor.after(card)
}
