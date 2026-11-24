// Строка разделов как барабан: выбранный раздел стоит по центру, соседи слева и справа
// видны, но приглушены и чуть меньше — чем дальше от центра, тем тише. Человек крутит
// строку пальцем; когда она остановилась, выбирается раздел в центре.

/** Насколько гаснет и уменьшается капсула у самого края строки. */
const EDGE_OPACITY = 0.35
const EDGE_SCALE = 0.9
/** Строка «остановилась», если столько времени нет новых событий прокрутки. */
const SETTLE_MS = 140

/**
 * Поля по краям — такие, чтобы и первую, и последнюю капсулу можно было поставить в центр.
 * @param {HTMLElement} row
 */
const fitEdges = (row) => {
  const capsules = row.querySelectorAll('[data-product]')
  const first = capsules[0]
  const last = capsules[capsules.length - 1]
  if (!first || !last || row.clientWidth === 0) return
  row.style.setProperty('--wheel-pad-start', `${Math.max(0, (row.clientWidth - first.offsetWidth) / 2)}px`)
  row.style.setProperty('--wheel-pad-end', `${Math.max(0, (row.clientWidth - last.offsetWidth) / 2)}px`)
}

/** Расстояние от середины капсулы до середины видимой части строки, в пикселях. */
const offCenter = (row, capsule) => {
  const rowBox = row.getBoundingClientRect()
  const box = capsule.getBoundingClientRect()
  return Math.abs(box.left + box.width / 2 - (rowBox.left + rowBox.width / 2))
}

/** Приглушает капсулы по расстоянию от центра строки. */
const paint = (row) => {
  const reach = row.clientWidth / 2
  row.querySelectorAll('[data-product]').forEach((capsule) => {
    const distance = Math.min(1, offCenter(row, capsule) / reach)
    capsule.style.setProperty('--wheel-opacity', String(1 - (1 - EDGE_OPACITY) * distance))
    capsule.style.setProperty('--wheel-scale', String(1 - (1 - EDGE_SCALE) * distance))
  })
}

/** Ближайшая к центру капсула, которую можно выбрать. */
const centered = (row) => {
  let best = null
  let bestDistance = Infinity
  row.querySelectorAll('[data-product]:not(:disabled)').forEach((capsule) => {
    const distance = offCenter(row, capsule)
    if (distance < bestDistance) {
      best = capsule
      bestDistance = distance
    }
  })
  return best
}

/**
 * @param {HTMLElement} row строка капсул [data-products]
 * @param {(capsule: HTMLElement) => void} onPick выбрать раздел, остановившийся в центре
 */
export const mountCapsuleWheel = (row, onPick) => {
  let frame = 0
  let settleTimer = 0
  // выбирать по остановке — только после прокрутки пальцем/колесом, не после нашей же
  // плавной доводки к выбранной капсуле
  let isUserTurning = false

  const repaint = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => paint(row))
  }
  const refit = () => {
    fitEdges(row)
    repaint()
  }

  const settle = () => {
    if (!isUserTurning) return
    isUserTurning = false
    const capsule = centered(row)
    if (capsule && capsule.getAttribute('aria-checked') !== 'true') onPick(capsule)
  }

  const markUser = () => {
    isUserTurning = true
  }
  row.addEventListener('touchstart', markUser, { passive: true })
  row.addEventListener('wheel', markUser, { passive: true })
  row.addEventListener('scroll', () => {
    repaint()
    clearTimeout(settleTimer)
    settleTimer = setTimeout(settle, SETTLE_MS)
  }, { passive: true })

  // капсулы гифт-карт дописываются позже, ширина экрана меняется — поля пересчитываем
  new ResizeObserver(refit).observe(row)
  new MutationObserver(refit).observe(row, { childList: true })
  refit()
}
