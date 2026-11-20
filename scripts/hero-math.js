// Математика проигрывателя шапки: значение свойства слоя на заданном кадре.
// Формат свойства — из assets/hero/*.json: либо готовый массив чисел,
// либо { k: [{ t, s, e?, to?, ti? }] } — ключевые кадры из анимации мини-приложения.

const EASE_ITERATIONS = 14
const CURVE_SAMPLES = 24
const MS_PER_SECOND = 1000

/** Кубическая кривая Безье с концами 0 и 1. */
const bezier = (first, second, t) => {
  const inverse = 1 - t
  return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t
}

/** Сглаживание времени, как в CSS cubic-bezier: по доле времени — доля пути. */
const ease = ([x1, y1, x2, y2], progress) => {
  let low = 0
  let high = 1
  for (let step = 0; step < EASE_ITERATIONS; step++) {
    const middle = (low + high) / 2
    if (bezier(x1, x2, middle) < progress) low = middle
    else high = middle
  }
  return bezier(y1, y2, (low + high) / 2)
}

const curvePoint = (from, to, tangentOut, tangentIn, t) => {
  const inverse = 1 - t
  return from.map(
    (start, axis) =>
      inverse ** 3 * start +
      3 * inverse * inverse * t * (start + tangentOut[axis]) +
      3 * inverse * t * t * (to[axis] + tangentIn[axis]) +
      t ** 3 * to[axis],
  )
}

/** Кривые участки пути считаются один раз: точки и накопленная длина до каждой. */
const curveCache = new WeakMap()

const curveTable = (key, next) => {
  const cached = curveCache.get(key)
  if (cached) return cached
  const points = Array.from({ length: CURVE_SAMPLES + 1 }, (_, index) =>
    curvePoint(key.s, next.s, key.to, key.ti, index / CURVE_SAMPLES),
  )
  const lengths = points.reduce((sums, point, index) => {
    if (index === 0) return [0]
    const previous = points[index - 1]
    return [...sums, sums[index - 1] + Math.hypot(point[0] - previous[0], point[1] - previous[1])]
  }, [])
  const table = { points, lengths }
  curveCache.set(key, table)
  return table
}

/** Точка на кривом участке, пройденном на долю progress по длине (а не по параметру). */
const alongCurve = (key, next, progress) => {
  const { points, lengths } = curveTable(key, next)
  const total = lengths[CURVE_SAMPLES]
  if (total === 0) return key.s
  const target = progress * total
  const index = Math.min(
    lengths.findIndex((length) => length >= target),
    CURVE_SAMPLES,
  )
  if (index <= 0) return points[0]
  const span = lengths[index] - lengths[index - 1]
  const local = span === 0 ? 0 : (target - lengths[index - 1]) / span
  return points[index - 1].map((value, axis) => value + (points[index][axis] - value) * local)
}

/**
 * @param {number[] | { k: Array<{ t: number, s: number[], e?: number[], to?: number[], ti?: number[] }> }} prop
 * @param {number} frame
 * @returns {number[]}
 */
export const valueAt = (prop, frame) => {
  if (Array.isArray(prop)) return prop
  const keys = prop.k
  if (frame <= keys[0].t) return keys[0].s
  const last = keys[keys.length - 1]
  if (frame >= last.t) return last.s
  const index = keys.findIndex((key) => key.t > frame) - 1
  const key = keys[index]
  const next = keys[index + 1]
  const linear = (frame - key.t) / (next.t - key.t)
  const progress = key.e ? ease(key.e, linear) : linear
  if (key.to) return alongCurve(key, next, progress)
  return key.s.map((value, axis) => value + (next.s[axis] - value) * progress)
}

/** Кадр зацикленной анимации для времени в миллисекундах. */
export const loopFrame = ({ fr, ip, op }, timeMs) => ip + (((timeMs * fr) / MS_PER_SECOND) % (op - ip))

const HEX_CHANNELS = [1, 3, 5]

/** Смесь двух цветов #rrggbb: ratio = 0 — первый, 1 — второй. */
export const mixHex = (from, to, ratio) =>
  `#${HEX_CHANNELS.map((offset) => {
    const start = parseInt(from.slice(offset, offset + 2), 16)
    const end = parseInt(to.slice(offset, offset + 2), 16)
    return Math.round(start + (end - start) * ratio)
      .toString(16)
      .padStart(2, '0')
  }).join('')}`
