// Шапка как в мини-приложении звёзд: круг-аватар и значки, разлетающиеся от него.
// Движение — из трёх анимаций мини-приложения (assets/hero/*.json: звёзды, Gram, USDT),
// собранных скриптом из его сборки; здесь они проигрываются на canvas.
// Для гифт-карт и разделов без своей анимации в то же движение подставляется другой значок.
// В круге — аватар получателя из Telegram, пока его нет — картинка Buddy.

import { loopFrame, mixHex, valueAt } from './hero-math.js'

const ANIMATION_URL = (name) => `assets/hero/${name}.json`
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

/** @typedef {{ path: Path2D, stroke?: number, fill?: boolean }} GlyphPart */
/** @typedef {{ key: string, animation: 'stars'|'gram'|'tether', color: string, glyph?: GlyphPart[] }} HeroView */

/**
 * Собирает значок из иконки раздела на странице: те же контуры, что видит покупатель.
 * @param {SVGElement} svg
 * @returns {GlyphPart[]}
 */
const glyphFromIcon = (svg) =>
  [...svg.querySelectorAll('path')]
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
    })

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
        shapes: data.shapes.map((shape) => ({ ...shape, path: new Path2D(shape.d) })),
        // у верхних слоёв меньший номер, а рисовать надо снизу вверх
        layers: [...data.layers].reverse(),
      }))
    animationCache.set(name, request)
  }
  return animationCache.get(name)
}

/** Рисует подставной значок на месте исходной фигуры — по центру её рамки и в её высоту. */
const drawGlyph = (context, glyph, [left, top, right, bottom]) => {
  const scale = (bottom - top) / GLYPH_GRID
  context.translate((left + right) / 2, (top + bottom) / 2)
  context.scale(scale, scale)
  context.translate(-GLYPH_GRID / 2, -GLYPH_GRID / 2)
  glyph.forEach((part) => {
    if (part.fill) context.fill(part.path, 'evenodd')
    if (part.stroke) {
      context.lineWidth = part.stroke
      context.lineJoin = 'round'
      context.stroke(part.path)
    }
  })
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

  return {
    async show(view) {
      if (wantedKey === view.key) return
      wantedKey = view.key
      root.style.setProperty('--hero-color', view.color)
      try {
        const animation = await loadAnimation(view.animation)
        if (wantedKey !== view.key) return // пока грузилось, покупатель выбрал другое
        scene = { view, animation, colors: shapeColors(animation, view) }
        if (isReducedMotion) draw(0)
        else start()
      } catch (error) {
        console.error(error) // шапка — украшение: без анимации магазин работает как обычно
      }
    },
    setAvatar,
  }
}

export const heroGlyph = {
  fromIcon: glyphFromIcon,
  /** @param {string} pathData логотип сервиса в сетке 24×24 */
  fromPath: (pathData) => [{ path: new Path2D(pathData), fill: true }],
}
