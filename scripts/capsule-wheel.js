// Строка разделов как барабан по кругу: выбранный раздел стоит по центру, соседи слева и
// справа видны, но приглушены и чуть меньше. Крутить можно бесконечно в обе стороны: слева и
// справа от настоящих капсул стоят их копии, а когда строка останавливается на копии, она
// незаметно перескакивает на такую же настоящую. Пока палец крутит строку, каждый новый раздел
// в центре отзывается лёгким щелчком; когда строка остановилась, выбирается раздел в центре.

import { el } from './dom.js?v=1795587922'
import { hapticSelection } from './telegram.js?v=1795587922'

/** Насколько гаснет и уменьшается капсула у самого края строки. */
const EDGE_OPACITY = 0.35
const EDGE_SCALE = 0.9
/** Строка «остановилась», если столько времени нет новых событий прокрутки. */
const SETTLE_MS = 90
/**
 * Палец уже отпущен, а раздел задержался в центре столько времени — выбираем его сразу,
 * не дожидаясь, пока строка докатится по инерции (на iPhone это ещё около секунды).
 */
const STABLE_MS = 130

const ORIGINALS = '[data-product]:not([data-clone])'

/** Ключ раздела: у гифт-карт — раздел и сервис. */
const keyOf = (capsule) => `${capsule.dataset.product}|${capsule.dataset.service ?? ''}`

/** Расстояние от середины капсулы до середины видимой части строки (со знаком), в пикселях.
 *  По раскладке, а не по экрану — сдвиги и масштаб капсул на него не влияют (строка — offsetParent). */
const offCenter = (row, capsule) =>
  capsule.offsetLeft + capsule.offsetWidth / 2 - (row.scrollLeft + row.clientWidth / 2)

/**
 * Приглушает капсулы по расстоянию от центра строки. В режиме «только иконки» по центру стоит
 * линза с названием: соседи плавно расступаются на её ширину, а иконка под линзой гаснет.
 * @param {HTMLElement} row
 * @param {HTMLElement | null} lens
 */
const paint = (row, lens) => {
  if (lens) lens.style.setProperty('--lens-top', `${row.offsetTop + parseFloat(getComputedStyle(row).paddingTop)}px`)
  const reach = row.clientWidth / 2
  const middle = lens && nearest(row)
  const slot = middle ? middle.offsetWidth + parseFloat(getComputedStyle(row).columnGap || '0') : 1
  const spread = middle ? Math.max(0, lens.offsetWidth - middle.offsetWidth) / 2 : 0
  row.querySelectorAll('[data-product]').forEach((capsule) => {
    const offset = offCenter(row, capsule)
    const distance = Math.min(1, Math.abs(offset) / reach)
    let opacity = 1 - (1 - EDGE_OPACITY) * distance
    if (lens) {
      const near = Math.max(-1, Math.min(1, offset / slot))
      capsule.style.setProperty('--wheel-shift', `${near * spread}px`)
      opacity *= Math.min(1, Math.abs(near) * 2)
    }
    capsule.style.setProperty('--wheel-opacity', String(opacity))
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
export const mountCapsuleWheel = (row, onPick, { iconsOnly = false } = {}) => {
  const lens = iconsOnly ? mountLens(row) : null
  let frame = 0
  let settleTimer = 0
  let centerKey = null
  // выбирать по остановке и щёлкать — только когда крутит человек, а не наша плавная доводка
  let isUserTurning = false

  const repaint = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => paint(row, lens))
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

  /** Выбирает раздел из центра; true — если выбор сменился (он сам доведёт раздел до центра). */
  const commit = (capsule) => {
    isUserTurning = false
    const original = originalOf(row, capsule)
    if (!original || original.getAttribute('aria-checked') === 'true') return false
    onPick(original)
    return true
  }

  // раздел задержался в центре после того, как палец отпущен, — выбираем, не ждём конца инерции
  let isTouching = false
  let stableTimer = 0
  let centerSince = performance.now()
  const commitWhenStable = () => {
    clearTimeout(stableTimer)
    const wait = Math.max(0, STABLE_MS - (performance.now() - centerSince))
    stableTimer = setTimeout(() => {
      if (isTouching || !isUserTurning) return
      const capsule = nearest(row, '[data-product]:not(:disabled)')
      // в центре всё ещё прежний выбранный раздел — ждём, куда докатится строка
      if (!capsule || originalOf(row, capsule)?.getAttribute('aria-checked') === 'true') return
      commit(capsule)
    }, wait)
  }

  const settle = () => {
    clearTimeout(stableTimer)
    jumpHome()
    const capsule = nearest(row, '[data-product]:not(:disabled)')
    if (!capsule) return
    if (isUserTurning && !isTouching && commit(capsule)) return
    // строка остановилась не на выбранном разделе (выбор уже сделан, а инерция докатила дальше) —
    // возвращаем выбранный в центр: в покое по центру всегда то, что выбрано
    if (!isUserTurning && originalOf(row, capsule)?.getAttribute('aria-checked') !== 'true') {
      const checked = row.querySelector(`${ORIGINALS}[aria-checked="true"]`)
      if (checked) centerCapsuleInWheel(row, checked, false)
      return
    }
    // с линзой браузерная доводка отключена (соседи сдвинуты) — доводим до центра сами
    if (lens && Math.abs(offCenter(row, capsule)) > 1) centerCapsuleInWheel(row, capsule, false)
  }

  /** Новый раздел в центре под пальцем — лёгкий щелчок, как у колёсика. */
  const tick = () => {
    const capsule = nearest(row)
    const key = capsule && keyOf(capsule)
    if (key === centerKey) return
    centerKey = key
    centerSince = performance.now()
    if (lens && capsule) showInLens(lens, capsule)
    if (!isUserTurning) return
    hapticSelection()
    commitWhenStable()
  }

  row.addEventListener('touchstart', () => {
    isTouching = true
    isUserTurning = true
    clearTimeout(stableTimer)
  }, { passive: true })
  const release = () => {
    isTouching = false
    commitWhenStable()
  }
  row.addEventListener('touchend', release, { passive: true })
  row.addEventListener('touchcancel', release, { passive: true })
  row.addEventListener('wheel', () => {
    isUserTurning = true
  }, { passive: true })
  row.addEventListener('scroll', () => {
    repaint()
    tick()
    clearTimeout(settleTimer)
    settleTimer = setTimeout(settle, SETTLE_MS)
  }, { passive: true })

  new ResizeObserver(repaint).observe(row)
  rebuild()
  tick()
}

// ── Режим «только иконки»: по краям иконки, по центру линза с иконкой и названием ──
const LENS_FADE = [{ opacity: 0.4 }, { opacity: 1 }]
const LENS_FADE_MS = 140

/** Линза над серединой строки. Нажатия проходят сквозь неё на капсулу под ней. */
const mountLens = (row) => {
  row.classList.add('products--icons')
  const lens = el('div', { class: 'product wheel-lens', 'aria-hidden': 'true', 'aria-checked': 'true' })
  row.after(lens)
  return lens
}

/** Показывает в линзе раздел из центра: его иконку, название и цвет. */
const showInLens = (lens, capsule) => {
  lens.className = `${capsule.className} wheel-lens`
  lens.style.cssText = capsule.style.cssText
  lens.replaceChildren(...[...capsule.childNodes].map((node) => node.cloneNode(true)))
  lens.animate(LENS_FADE, { duration: LENS_FADE_MS, easing: 'ease-out' })
}
