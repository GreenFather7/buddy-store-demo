// Строка разделов как барабан по кругу: выбранный раздел стоит по центру, соседи слева и
// справа видны, но приглушены и чуть меньше. Крутить можно бесконечно в обе стороны: слева и
// справа от настоящих капсул стоят их копии, а когда строка останавливается на копии, она
// незаметно перескакивает на такую же настоящую. Пока палец крутит строку, каждый новый раздел
// в центре отзывается лёгким щелчком; когда строка остановилась, выбирается раздел в центре.

import { hapticSelection } from './telegram.js?v=1795514178'

/** Насколько гаснет и уменьшается капсула у самого края строки. */
const EDGE_OPACITY = 0.35
const EDGE_SCALE = 0.9
/** Строка «остановилась», если столько времени нет новых событий прокрутки. */
const SETTLE_MS = 140

const ORIGINALS = '[data-product]:not([data-clone])'

/** Ключ раздела: у гифт-карт — раздел и сервис. */
const keyOf = (capsule) => `${capsule.dataset.product}|${capsule.dataset.service ?? ''}`

/** Расстояние от середины капсулы до середины видимой части строки (со знаком), в пикселях. */
const offCenter = (row, capsule) => {
  const rowBox = row.getBoundingClientRect()
  const box = capsule.getBoundingClientRect()
  return box.left + box.width / 2 - (rowBox.left + rowBox.width / 2)
}

/** Приглушает капсулы по расстоянию от центра строки. */
const paint = (row) => {
  const reach = row.clientWidth / 2
  row.querySelectorAll('[data-product]').forEach((capsule) => {
    const distance = Math.min(1, Math.abs(offCenter(row, capsule)) / reach)
    capsule.style.setProperty('--wheel-opacity', String(1 - (1 - EDGE_OPACITY) * distance))
    capsule.style.setProperty('--wheel-scale', String(1 - (1 - EDGE_SCALE) * distance))
  })
}

/** Ближайшая к центру капсула (среди подходящих под selector). */
const nearest = (row, selector = '[data-product]') => {
  let best = null
  let bestDistance = Infinity
  row.querySelectorAll(selector).forEach((capsule) => {
    const distance = Math.abs(offCenter(row, capsule))
    if (distance < bestDistance) {
      best = capsule
      bestDistance = distance
    }
  })
  return best
}

const originalOf = (row, capsule) =>
  capsule.hasAttribute('data-clone')
    ? [...row.querySelectorAll(ORIGINALS)].find((original) => keyOf(original) === keyOf(capsule))
    : capsule

/** Копия капсулы для круга: та же внешне, но невидима для чтения с экрана и Tab. */
const cloneOf = (capsule) => {
  const copy = capsule.cloneNode(true)
  copy.setAttribute('data-clone', '')
  copy.setAttribute('aria-hidden', 'true')
  copy.setAttribute('tabindex', '-1')
  copy.removeAttribute('id')
  return copy
}

/** Копии повторяют выбор настоящих капсул — чтобы на копии в центре была та же подсветка. */
const syncClones = (row) => {
  const checked = new Map([...row.querySelectorAll(ORIGINALS)].map((c) => [keyOf(c), c.getAttribute('aria-checked')]))
  row.querySelectorAll('[data-clone]').forEach((copy) => {
    copy.setAttribute('aria-checked', checked.get(keyOf(copy)) ?? 'false')
  })
}

/**
 * Ставит в центр ту копию раздела, что ближе всего, — чтобы не крутить через весь круг.
 * @param {HTMLElement} row
 * @param {HTMLElement} capsule настоящая капсула выбранного раздела
 * @param {boolean} isInstant без плавности (уменьшение движения, первая отрисовка)
 */
export const centerCapsuleInWheel = (row, capsule, isInstant) => {
  const twins = [...row.querySelectorAll('[data-product]')].filter((other) => keyOf(other) === keyOf(capsule))
  const target = twins.reduce((best, twin) => (Math.abs(offCenter(row, twin)) < Math.abs(offCenter(row, best)) ? twin : best), capsule)
  row.scrollTo({ left: row.scrollLeft + offCenter(row, target), behavior: isInstant ? 'auto' : 'smooth' })
}

/**
 * @param {HTMLElement} row строка капсул [data-products]
 * @param {(capsule: HTMLElement) => void} onPick выбрать раздел (настоящую капсулу), остановившийся в центре
 */
export const mountCapsuleWheel = (row, onPick) => {
  let frame = 0
  let settleTimer = 0
  let centerKey = null
  // выбирать по остановке и щёлкать — только когда крутит человек, а не наша плавная доводка
  let isUserTurning = false

  const repaint = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => paint(row))
  }

  // Копии пересобираются, когда меняется набор настоящих капсул (гифт-карты приходят позже).
  // Пока пересобираем, наблюдатель выключен — иначе он поймал бы свои же изменения.
  const childWatch = new MutationObserver(() => rebuild())
  const checkWatch = new MutationObserver(() => syncClones(row))
  const watch = () => {
    childWatch.observe(row, { childList: true })
    row.querySelectorAll(ORIGINALS).forEach((capsule) => checkWatch.observe(capsule, { attributeFilter: ['aria-checked'] }))
  }
  const rebuild = () => {
    childWatch.disconnect()
    checkWatch.disconnect()
    const centeredKey = nearest(row) && keyOf(nearest(row))
    row.querySelectorAll('[data-clone]').forEach((copy) => copy.remove())
    const originals = [...row.querySelectorAll(ORIGINALS)]
    if (originals.length > 1) {
      row.prepend(...originals.map(cloneOf))
      row.append(...originals.map(cloneOf))
    }
    syncClones(row)
    // тот же раздел остаётся в центре — на своей настоящей капсуле
    const keep = originals.find((capsule) => keyOf(capsule) === centeredKey) ?? row.querySelector(`${ORIGINALS}[aria-checked="true"]`)
    if (keep) row.scrollTo({ left: row.scrollLeft + offCenter(row, keep), behavior: 'auto' })
    watch()
    repaint()
  }

  /** Остановились на копии — перескакиваем на такую же настоящую, на глаз ничего не меняется. */
  const jumpHome = () => {
    const capsule = nearest(row)
    if (!capsule?.hasAttribute('data-clone')) return
    const original = originalOf(row, capsule)
    if (original) row.scrollTo({ left: row.scrollLeft + offCenter(row, original) - offCenter(row, capsule), behavior: 'auto' })
  }

  const settle = () => {
    jumpHome()
    if (!isUserTurning) return
    isUserTurning = false
    const capsule = nearest(row, '[data-product]:not(:disabled)')
    const original = capsule && originalOf(row, capsule)
    if (original && original.getAttribute('aria-checked') !== 'true') onPick(original)
  }

  /** Новый раздел в центре под пальцем — лёгкий щелчок, как у колёсика. */
  const tick = () => {
    const capsule = nearest(row)
    const key = capsule && keyOf(capsule)
    if (key === centerKey) return
    centerKey = key
    if (isUserTurning) hapticSelection()
  }

  const markUser = () => {
    isUserTurning = true
  }
  row.addEventListener('touchstart', markUser, { passive: true })
  row.addEventListener('wheel', markUser, { passive: true })
  row.addEventListener('scroll', () => {
    repaint()
    tick()
    clearTimeout(settleTimer)
    settleTimer = setTimeout(settle, SETTLE_MS)
  }, { passive: true })

  new ResizeObserver(repaint).observe(row)
  rebuild()
}
