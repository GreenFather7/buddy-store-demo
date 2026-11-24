// Подсказка «ряд листается»: при открытии строка разделов слегка проезжает влево и
// возвращается. Показываем, пока человек сам ни разу не пролистал строку.

const SEEN_KEY = 'buddy.products.scrolled'
const START_DELAY_MS = 1200
const HOLD_MS = 650
/** На сколько проезжает строка: заметно, но выбранный раздел остаётся на экране. */
const PEEK_SHARE = 0.35
const PEEK_MAX_PX = 140

const wasScrolled = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

const rememberScrolled = () => {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // без хранилища подсказка просто покажется и в следующий раз
  }
}

/**
 * @param {HTMLElement} row строка, которая листается вбок
 * @param {MediaQueryList} lessMotion prefers-reduced-motion
 */
export const hintRowScroll = (row, lessMotion) => {
  // человек сам потянул строку пальцем или колесом — дальше подсказка не нужна
  const onUserScroll = () => {
    rememberScrolled()
    row.removeEventListener('touchstart', onUserScroll)
    row.removeEventListener('wheel', onUserScroll)
  }
  row.addEventListener('touchstart', onUserScroll, { passive: true })
  row.addEventListener('wheel', onUserScroll, { passive: true })

  if (wasScrolled() || lessMotion.matches) return
  setTimeout(() => {
    const room = row.scrollWidth - row.clientWidth - row.scrollLeft
    if (row.hidden || room < 1) return
    const start = row.scrollLeft
    const shift = Math.min(room, PEEK_MAX_PX, row.clientWidth * PEEK_SHARE)
    row.scrollTo({ left: start + shift, behavior: 'smooth' })
    setTimeout(() => row.scrollTo({ left: start, behavior: 'smooth' }), HOLD_MS)
  }, START_DELAY_MS)
}
