// Шапка как в мини-приложении звёзд: круг-аватар и значки, разлетающиеся от него.
// Движение — из трёх анимаций мини-приложения (assets/hero/*.json: звёзды, Gram, USDT),
// собранных скриптом из его сборки; здесь они проигрываются на canvas.
// Для гифт-карт и разделов без своей анимации в то же движение подставляется другой значок.
// В круге — аватар получателя из Telegram, пока его нет — картинка Buddy.

import { loopFrame, mixHex, valueAt } from './hero-math.js?v=1795441095'

const ANIMATION_URL = (name) => `assets/hero/${name}.json`
/** Сколько раз и через сколько повторить загрузку анимации, если она не пришла. */
const HERO_RETRIES = 3
const HERO_RETRY_MS = 2000
const GLYPH_GRID = 24
const MAX_DEVICE_PIXEL_RATIO = 2
const PERCENT = 100
/** Кадр для тех, кто просил меньше движения: доля цикла, где значков на экране много. */
const STILL_FRAME_SHARE = 0.45
const WHITE = '#ffffff'
/** Подставные значки чуть высветляются, чтобы тёмные фирменные цвета читались на тёмном фоне.
    Вторые по счёту значки светлее основных, искры — ещё светлее (как в исходных анимациях). */
const FIRST_TONE_MIX = 0.18
const SECOND_TONE_MIX = 0.42
const SPARK_MIX = 0.6

/**
 * Все значки летают одного размера — как звёзды в первом разделе. Это обычный (медианный) размер
 * звезды в её анимации, доля ширины шапки; Gram и USDT в своих анимациях крупнее и подгоняются под неё.
 * По медиане, а не по максимуму: у Gram кристалл на миг сильно увеличивается, и по нему всё стало бы мелким.
 */
const STAR_GLYPH_SHARE = 0.0228
/** Значок считается видимым, когда он непрозрачен больше чем наполовину (проценты). */
const VISIBLE_OPACITY = 50
/** Подставной значок рисуется крупно на скрытом холсте, чтобы найти, где сам рисунок (без полей). */
const BOUNDS_SCALE = 4

/** @typedef {{ path: Path2D, stroke?: number, fill?: boolean }} GlyphPart */
/** @typedef {{ parts: GlyphPart[], bounds: [number, number, number, number] }} Glyph */
/** @typedef {{ key: string, animation: 'stars'|'gram'|'tether', color: string, glyph?: Glyph }} HeroView */

const fillParts = (context, parts) =>
  parts.forEach((part) => {
    if (part.fill) context.fill(part.path, 'evenodd')
    if (part.stroke) {
      context.lineWidth = part.stroke
      context.lineJoin = 'round'
      context.stroke(part.path)
    }
  })

/** Где в сетке 24×24 сам рисунок: у логотипов и иконок вокруг него разные поля. */
const glyphBounds = (parts) => {
  const side = GLYPH_GRID * BOUNDS_SCALE
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return [0, 0, GLYPH_GRID, GLYPH_GRID]
  context.scale(BOUNDS_SCALE, BOUNDS_SCALE)
  fillParts(context, parts)
  const { data } = context.getImageData(0, 0, side, side)
  let [left, top, right, bottom] = [side, side, -1, -1]
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      if (data[(y * side + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < 0) return [0, 0, GLYPH_GRID, GLYPH_GRID]
  return [left / BOUNDS_SCALE, top / BOUNDS_SCALE, (right + 1) / BOUNDS_SCALE, (bottom + 1) / BOUNDS_SCALE]
}

/** @param {GlyphPart[]} parts @returns {Glyph} */
const makeGlyph = (parts) => ({ parts, bounds: glyphBounds(parts) })

/**
 * Собирает значок из иконки раздела на странице: те же контуры, что видит покупатель.
 * @param {SVGElement} svg
 * @returns {Glyph}
 */
const glyphFromIcon = (svg) =>
  makeGlyph([...svg.querySelectorAll('path')]
    .filter((node) => !node.closest('defs'))
    .map((node) => {
      const source = new Path2D(node.getAttribute('d') ?? '')
      const matrix = node.transform.baseVal.consolidate()?.matrix
      const path = new Path2D()
      path.addPath(source, matrix ?? undefined)
      const strokeWidth = Number(node.getAttribute('stroke-width')) || 0
      return {
        path,
        fill: node.getAttribute('fill') !== 'none',
        stroke: node.hasAttribute('stroke') ? strokeWidth * (matrix?.a ?? 1) : undefined,
      }
    }))

/** Обычный (медианный) размер значка анимации — доля её ширины, по всем кадрам, где значок виден. */
const typicalGlyphShare = (data) => {
  const sizes = []
  data.layers.forEach((layer) => {
    const shape = data.shapes[layer.sh]
    if (!shape.glyph) return
    for (let frame = layer.ip; frame < layer.op; frame += 2) {
      if (valueAt(layer.o, frame)[0] <= VISIBLE_OPACITY) continue
      const [scaleX, scaleY] = valueAt(layer.s, frame)
      const width = (shape.box[2] - shape.box[0]) * (scaleX / PERCENT)
      const height = (shape.box[3] - shape.box[1]) * (scaleY / PERCENT)
      sizes.push(Math.max(width, height))
    }
  })
  if (sizes.length === 0) return 0
  const sorted = [...sizes].sort((first, second) => first - second)
  return sorted[Math.floor(sorted.length / 2)] / data.w
}

const animationCache = new Map()

/** Загружает анимацию один раз и готовит контуры для canvas. */
const loadAnimation = (name) => {
  if (!animationCache.has(name)) {
    const request = fetch(ANIMATION_URL(name))
      .then((response) => {
        if (!response.ok) throw new Error(`анимация ${name}: ${response.status}`)
        return response.json()
      })
      .then((data) => ({
        ...data,
        // во сколько раз уменьшить значки этой анимации, чтобы они были как звёзды
        glyphScale: Math.min(1, STAR_GLYPH_SHARE / (typicalGlyphShare(data) || STAR_GLYPH_SHARE)),
        shapes: data.shapes.map((shape) => ({ ...shape, path: new Path2D(shape.d) })),
        // у верхних слоёв меньший номер, а рисовать надо снизу вверх
        layers: [...data.layers].reverse(),
      }))
      .catch((error) => {
        // неудачную загрузку не запоминаем — следующий показ попробует снова
        animationCache.delete(name)
        throw error
      })
    animationCache.set(name, request)
  }
  return animationCache.get(name)
}

/**
 * Рисует подставной значок на месте исходной фигуры: по центру её рамки, и сам рисунок
 * (без полей вокруг него в сетке 24×24) занимает рамку так же, как исходная звезда.
 */
const drawGlyph = (context, glyph, [left, top, right, bottom]) => {
  const [glyphLeft, glyphTop, glyphRight, glyphBottom] = glyph.bounds
  const scale = Math.max(right - left, bottom - top) / Math.max(glyphRight - glyphLeft, glyphBottom - glyphTop)
  context.translate((left + right) / 2, (top + bottom) / 2)
  context.scale(scale, scale)
  context.translate(-(glyphLeft + glyphRight) / 2, -(glyphTop + glyphBottom) / 2)
  fillParts(context, glyph.parts)
}

/** Цвета фигур: исходные, если значок свой, иначе оттенки цвета выбранного раздела или сервиса. */
const shapeColors = (animation, view) => {
  if (!view.glyph) return animation.shapes.map((shape) => shape.color)
  const glyphTones = [mixHex(view.color, WHITE, FIRST_TONE_MIX), mixHex(view.color, WHITE, SECOND_TONE_MIX)]
  let glyphIndex = 0
  return animation.shapes.map((shape) =>
    shape.glyph ? glyphTones[glyphIndex++ % glyphTones.length] : mixHex(view.color, WHITE, SPARK_MIX),
  )
}

/**
 * @param {HTMLElement} root элемент [data-hero]
 * @returns {{ show: (view: HeroView) => Promise<void>, setAvatar: (url: string | null) => void }}
 */
export const createHero = (root) => {
  const canvas = root.querySelector('[data-hero-canvas]')
  const avatar = root.querySelector('[data-hero-avatar]')
  const photo = root.querySelector('[data-hero-photo]')
  const defaultPhoto = photo.getAttribute('src')
  const context = canvas.getContext('2d')
  const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /** Что сейчас на экране: { view, animation, colors } — заменяется целиком. */
  let scene = null
  let wantedKey = null
  let wantedAvatar = null
  let size = 0
  let frameId = 0
  let startTime = 0

  const draw = (timeMs) => {
    context.clearRect(0, 0, size, size)
    if (!scene) return
    const { animation, colors, view } = scene
    const frame = isReducedMotion
      ? animation.ip + (animation.op - animation.ip) * STILL_FRAME_SHARE
      : loopFrame(animation, timeMs)
    const unit = size / animation.w
    animation.layers.forEach((layer) => {
      if (frame < layer.ip || frame >= layer.op) return
      const opacity = valueAt(layer.o, frame)[0] / PERCENT
      if (opacity <= 0) return
      const [x, y] = valueAt(layer.p, frame)
      const [scaleX, scaleY] = valueAt(layer.s, frame)
      const shape = animation.shapes[layer.sh]
      context.save()
      context.globalAlpha = Math.min(opacity, 1)
      context.translate(x * unit, y * unit)
      context.scale((scaleX / PERCENT) * unit, (scaleY / PERCENT) * unit)
      context.translate(-layer.a[0], -layer.a[1])
      context.fillStyle = colors[layer.sh]
      context.strokeStyle = colors[layer.sh]
      // значки уменьшаются вокруг своего центра — до размера звёзд; искры не трогаем
      if (shape.glyph && animation.glyphScale !== 1) {
        const centerX = (shape.box[0] + shape.box[2]) / 2
        const centerY = (shape.box[1] + shape.box[3]) / 2
        context.translate(centerX, centerY)
        context.scale(animation.glyphScale, animation.glyphScale)
        context.translate(-centerX, -centerY)
      }
      if (view.glyph && shape.glyph) drawGlyph(context, view.glyph, shape.box)
      else context.fill(shape.path)
      context.restore()
    })
  }

  const tick = (time) => {
    if (!startTime) startTime = time
    draw(time - startTime)
    frameId = requestAnimationFrame(tick)
  }

  const start = () => {
    if (isReducedMotion || frameId || document.hidden || !scene) return
    frameId = requestAnimationFrame(tick)
  }

  const stop = () => {
    cancelAnimationFrame(frameId)
    frameId = 0
  }

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO)
    size = canvas.clientWidth
    canvas.width = Math.round(size * ratio)
    canvas.height = Math.round(size * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (isReducedMotion || !frameId) draw(0)
  }

  new ResizeObserver(resize).observe(canvas)
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()))

  const setAvatar = (url) => {
    wantedAvatar = url
    if (!url) {
      photo.src = defaultPhoto
      avatar.classList.remove('hero__avatar--user')
      return
    }
    // Картинка сначала грузится в стороне: нет аватара — в круге остаётся Buddy.
    const probe = new Image()
    probe.referrerPolicy = 'no-referrer'
    probe.addEventListener('load', () => {
      if (wantedAvatar !== url) return
      photo.src = url
      avatar.classList.add('hero__avatar--user')
    })
    probe.addEventListener('error', () => {
      if (wantedAvatar === url) setAvatar(null)
    })
    probe.src = url
  }

  const show = async (view, attempt = 0) => {
    if (wantedKey === view.key && attempt === 0) return
    wantedKey = view.key
    root.style.setProperty('--hero-color', view.color)
    try {
      const animation = await loadAnimation(view.animation)
      if (wantedKey !== view.key) return // пока грузилось, покупатель выбрал другое
      scene = { view, animation, colors: shapeColors(animation, view) }
      if (isReducedMotion) draw(0)
      else start()
    } catch (error) {
      // шапка — украшение: без анимации магазин работает как обычно; но сбой сети (например,
      // во время выкладки сайта) не должен оставить шапку пустой — пробуем ещё пару раз
      console.error(error)
      if (attempt < HERO_RETRIES && wantedKey === view.key) {
        setTimeout(() => wantedKey === view.key && show(view, attempt + 1), HERO_RETRY_MS)
      }
    }
  }

  return {
    show: (view) => show(view),
    setAvatar,
  }
}

export const heroGlyph = {
  fromIcon: glyphFromIcon,
  /** @param {string} pathData логотип сервиса в сетке 24×24 */
  fromPath: (pathData) => makeGlyph([{ path: new Path2D(pathData), fill: true }]),
}
