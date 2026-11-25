// Экспериментальный вход «Орбита» (?orbit=1): вместо строки разделов — аватар покупателя,
// вокруг которого, как электроны вокруг ядра, по трём наклонённым орбитам летают сервисы:
// ближняя — Telegram (звёзды, Premium, Gram, подарки), средняя — игры, дальняя — остальные карты. Орбиты можно крутить пальцем,
// с инерцией и щелчками вибрации. Нажатие на сервис — он улетает в аватар, остальные
// разлетаются, а аватар переезжает в шапку формы. Обычный магазин без параметра не меняется.

import { el } from './dom.js?v=1795612634'
import { hapticSelection } from './telegram.js?v=1795612634'

const ORIGINALS = '[data-product]:not([data-clone])'
/**
 * Орбиты: кто на ней летает, размер (доля от ширины), наклон (высота эллипса к ширине),
 * поворот в градусах и скорость в рад/с. Сервисы, не попавшие в первые две, — на третью.
 */
const RINGS = [
  { has: (product) => ['stars', 'premium', 'gram', 'gifts'].includes(product), size: 0.72, tilt: 0.55, turn: -20, speed: 0.18 },
  { has: (product, service) => ['steam', 'gta'].includes(product) || ['ps', 'xbox', 'nintendo', 'roblox'].includes(service), size: 1.04, tilt: 0.42, turn: 18, speed: -0.11 },
  { has: () => true, size: 1.75, tilt: 0.36, turn: -72, speed: 0.08 },
]
const FALLBACK_AVATAR = 'assets/buddy.png'

/** Как быстро разогнанная пальцем орбита возвращается к своей скорости (доля за секунду). */
const SPIN_DECAY = 2.2
const TAP_SLOP_PX = 8
const PLANET_MIN_SCALE = 0.62
const PLANET_MIN_OPACITY = 0.38
const SKY_STARS = 260

const IN_MS = 520
const OUT_MS = 560
const FLIGHT_MS = 640

const prefersLessMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const keyOf = (capsule) => `${capsule.dataset.product}|${capsule.dataset.service ?? ''}`
const ms = (value) => (prefersLessMotion() ? 1 : value)

/** Средний толчок при выборе — в Telegram его тактильный отклик, в браузере короткая вибрация. */
const hapticImpact = () => {
  const app = window.Telegram?.WebApp
  if (app?.HapticFeedback && app.isVersionAtLeast?.('6.1')) app.HapticFeedback.impactOccurred('medium')
  else navigator.vibrate?.(18)
}

/** Свой аватар из Telegram; вне Telegram — робот Buddy. */
const ownAvatar = () => {
  const url = window.Telegram?.WebApp?.initDataUnsafe?.user?.photo_url
  return typeof url === 'string' && url.startsWith('https://') ? url : FALLBACK_AVATAR
}

/**
 * Копия значка капсулы. У SVG-градиентов меняются id: строка разделов в этом режиме скрыта,
 * а ссылка url(#…) на градиент внутри скрытого элемента не рисуется.
 */
const iconOf = (capsule, index) => {
  const icon = capsule.querySelector('.product__icon')?.cloneNode(true)
  if (!icon) return null
  icon.querySelectorAll('[id]').forEach((node) => {
    const fresh = `orbit-${index}-${node.id}`
    icon.querySelectorAll('[fill], [stroke]').forEach((user) => {
      ;['fill', 'stroke'].forEach((attr) => {
        if (user.getAttribute(attr) === `url(#${node.id})`) user.setAttribute(attr, `url(#${fresh})`)
      })
    })
    node.id = fresh
  })
  icon.classList.add('orbit__icon')
  return icon
}

/** Звёздное небо — рисуется один раз, дальше медленно поворачивается целиком (CSS). */
const paintSky = (canvas) => {
  const size = Math.ceil(Math.hypot(window.innerWidth, window.innerHeight))
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = size * ratio
  canvas.height = size * ratio
  canvas.style.setProperty('--sky-size', `${size}px`)
  const context = canvas.getContext('2d')
  context.scale(ratio, ratio)
  for (let i = 0; i < SKY_STARS; i += 1) {
    const radius = Math.random() < 0.08 ? 1.3 : Math.random() * 0.8 + 0.2
    context.globalAlpha = Math.random() * 0.7 + 0.15
    context.fillStyle = Math.random() < 0.15 ? '#ffcf70' : '#ffffff'
    context.beginPath()
    context.arc(Math.random() * size, Math.random() * size, radius, 0, Math.PI * 2)
    context.fill()
  }
}

const planetOf = (capsule, index) => {
  const label = capsule.textContent.trim()
  const planet = el('button', { class: 'orbit__planet', type: 'button', 'aria-label': label, 'data-key': keyOf(capsule) }, [
    el('span', { class: 'orbit__body' }, [iconOf(capsule, index)]),
    el('span', { class: 'orbit__label', text: label }),
  ])
  planet.style.setProperty('--planet-color', getComputedStyle(capsule).getPropertyValue('--product-color').trim() || '#ffb224')
  return { planet, capsule, x: 0, y: 0 }
}

/**
 * @param {{ productsEl: HTMLElement, checkoutEl: HTMLElement, onPick: (product: string, service?: string) => void }} options
 */
export const mountOrbit = ({ productsEl, checkoutEl, onPick }) => {
  document.documentElement.classList.add('orbit-mode')
  const sky = el('canvas', { class: 'orbit__sky', 'aria-hidden': 'true' })
  const backdrop = el('div', { class: 'orbit__backdrop' }, [sky])
  const core = el('div', { class: 'orbit__core' }, [
    el('img', { class: 'orbit__photo', src: ownAvatar(), alt: '', width: '112', height: '112', referrerpolicy: 'no-referrer' }),
  ])
  const rings = RINGS.map((spec) => ({ ...spec, el: el('div', { class: 'orbit__ring' }), phase: Math.random() * Math.PI, spin: spec.speed, items: [], rx: 0, ry: 0, front: null }))
  const stage = el('div', { class: 'orbit__stage' }, [...rings.map((ring) => ring.el), core])
  const title = el('h2', { class: 'orbit__title' }, ['Что ', el('span', { class: 'shine', text: 'покупаем?' })])
  const hint = el('p', { class: 'orbit__hint', text: 'Крутите орбиты · нажмите на сервис' })
  const overlay = el('div', { class: 'orbit', role: 'dialog', 'aria-label': 'Выбор сервиса' }, [backdrop, title, stage, hint])
  document.body.append(overlay)
  paintSky(sky)

  const back = el('button', { class: 'orbit-back', type: 'button', 'aria-label': 'Выбрать другой сервис' })
  checkoutEl.prepend(back)

  let cx = 0
  let cy = 0
  let isRunning = true
  let isBusy = false
  let frame = 0
  let last = performance.now()
  let drag = null

  const allItems = () => rings.flatMap((ring) => ring.items)

  const build = () => {
    const capsules = [...productsEl.querySelectorAll(ORIGINALS)].filter((capsule) => !capsule.disabled)
    const known = allItems().map((item) => keyOf(item.capsule)).join()
    if (capsules.map(keyOf).join() === known) return
    allItems().forEach((item) => item.planet.remove())
    const made = capsules.map(planetOf)
    rings.forEach((ring) => {
      ring.items = []
    })
    made.forEach((item) => {
      const { product, service } = item.capsule.dataset
      rings.find((ring) => ring.has(product, service)).items.push(item)
    })
    stage.append(...made.map((item) => item.planet))
    layout()
  }

  const layout = () => {
    const { width, height } = stage.getBoundingClientRect()
    // орбита скрыта — размеров нет, оставляем прежние
    if (width === 0 || height === 0) return
    cx = width / 2
    cy = height / 2
    const unit = Math.max(100, Math.min(width / 2 - 36, 220))
    rings.forEach((ring) => {
      // дальняя орбита почти вертикальна — ей ограничение по высоте экрана
      ring.rx = Math.min(unit * ring.size, height / 2 - 48)
      ring.ry = ring.rx * ring.tilt
      ring.cos = Math.cos((ring.turn * Math.PI) / 180)
      ring.sin = Math.sin((ring.turn * Math.PI) / 180)
      ring.el.style.setProperty('--rx', `${ring.rx}px`)
      ring.el.style.setProperty('--ry', `${ring.ry}px`)
      ring.el.style.setProperty('--turn', `${ring.turn}deg`)
    })
    stage.style.setProperty('--core-size', `${Math.round(Math.min(112, Math.max(76, rings[0].rx * 0.82)))}px`)
  }

  // ── Движение ──
  const place = (ring) => {
    const count = ring.items.length
    let front = null
    let frontDepth = -Infinity
    ring.items.forEach((item, index) => {
      const angle = ring.phase + (index * Math.PI * 2) / count
      const depth = Math.sin(angle) // 1 — ближе всего к нам (низ эллипса), −1 — за аватаром
      const near = (depth + 1) / 2
      const ex = ring.rx * Math.cos(angle)
      const ey = ring.ry * depth
      item.x = cx + ex * ring.cos - ey * ring.sin
      item.y = cy + ex * ring.sin + ey * ring.cos
      item.planet.style.transform = `translate3d(${item.x}px, ${item.y}px, 0) translate(-50%, -50%) scale(${PLANET_MIN_SCALE + (1 - PLANET_MIN_SCALE) * near})`
      item.planet.style.opacity = String(PLANET_MIN_OPACITY + (1 - PLANET_MIN_OPACITY) * near)
      item.planet.style.zIndex = depth > 0 ? '3' : '1'
      item.planet.classList.toggle('orbit__planet--back', depth < -0.2)
      if (depth > frontDepth) {
        frontDepth = depth
        front = item
      }
    })
    // щелчок — только когда орбиту крутит человек, не при спокойном вращении
    if (front !== ring.front) {
      if (ring.front && (drag?.ring === ring || Math.abs(ring.spin - ring.speed) > 0.3)) hapticSelection()
      ring.front = front
    }
  }

  const step = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    rings.forEach((ring) => {
      if (drag?.ring !== ring) {
        const base = prefersLessMotion() ? 0 : ring.speed
        ring.spin = base + (ring.spin - base) * Math.exp(-SPIN_DECAY * dt)
        ring.phase += ring.spin * dt
      }
      place(ring)
    })
    if (isRunning) frame = requestAnimationFrame(step)
  }
  const run = () => {
    cancelAnimationFrame(frame)
    isRunning = true
    last = performance.now()
    frame = requestAnimationFrame(step)
  }

  // ── Палец: крутим ту орбиту, ближе к которой коснулись ──
  const local = (event) => {
    const box = stage.getBoundingClientRect()
    return { x: event.clientX - box.left - cx, y: event.clientY - box.top - cy }
  }
  /** Точка в осях орбиты (без её поворота), в долях радиусов. */
  const onRing = (ring, point) => ({
    x: (point.x * ring.cos + point.y * ring.sin) / ring.rx,
    y: (-point.x * ring.sin + point.y * ring.cos) / ring.ry,
  })
  const angleOn = (ring, point) => {
    const { x, y } = onRing(ring, point)
    return Math.atan2(y, x)
  }

  stage.addEventListener('pointerdown', (event) => {
    if (isBusy) return
    const point = local(event)
    // ближе всего к точке касания — по расстоянию до линии эллипса
    const reach = (ring) => {
      const { x, y } = onRing(ring, point)
      return Math.abs(Math.hypot(x, y) - 1) * ring.ry
    }
    const ring = rings.reduce((best, other) => (reach(other) < reach(best) ? other : best))
    drag = { ring, start: point, angle: angleOn(ring, point), time: event.timeStamp, moved: false, planet: event.target.closest('.orbit__planet') }
    ring.spin = 0
    stage.setPointerCapture(event.pointerId)
  })
  stage.addEventListener('pointermove', (event) => {
    if (!drag) return
    const point = local(event)
    if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > TAP_SLOP_PX) drag.moved = true
    if (!drag.moved) return
    const angle = angleOn(drag.ring, point)
    let delta = angle - drag.angle
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2
    const dt = Math.max(1, event.timeStamp - drag.time) / 1000
    drag.ring.phase += delta
    drag.ring.spin = delta / dt
    drag.angle = angle
    drag.time = event.timeStamp
  })
  const release = () => {
    if (!drag) return
    const { planet, moved, ring } = drag
    drag = null
    ring.spin = Math.max(-9, Math.min(9, ring.spin))
    if (!moved && planet) pick(allItems().find((item) => item.planet === planet))
  }
  stage.addEventListener('pointerup', release)
  stage.addEventListener('pointercancel', release)
  // клавиатура: Tab по сервисам, Enter — выбрать
  stage.addEventListener('keydown', (event) => {
    const planet = event.target.closest?.('.orbit__planet')
    if (planet && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      pick(allItems().find((item) => item.planet === planet))
    }
  })

  // ── Переходы ──
  // Анимации выбора застывают в конце (разлёт, погасший заголовок) и снимаются при следующем
  // открытии. Список ведём сами: у скрытого элемента браузер их не перечисляет, а действуют они.
  let traces = []
  const leave = (node, keyframes, options) => {
    const animation = node.animate(keyframes, { ...options, fill: 'forwards' })
    traces = [...traces, animation]
    return animation
  }
  const clearTraces = () => {
    traces.forEach((animation) => animation.cancel())
    traces = []
  }

  const heroRect = () => document.querySelector('[data-hero-avatar]')?.getBoundingClientRect()

  /** Сдвиг и масштаб, которые переносят ядро орбиты на место аватара в шапке формы. */
  const flightToHero = () => {
    const from = core.getBoundingClientRect()
    const to = heroRect()
    if (!to || from.width === 0) return 'none'
    const dx = to.left + to.width / 2 - (from.left + from.width / 2)
    const dy = to.top + to.height / 2 - (from.top + from.height / 2)
    return `translate(${dx}px, ${dy}px) scale(${to.width / from.width})`
  }

  const setBackLabel = (item) => {
    back.replaceChildren(
      el('span', { class: 'orbit-back__body' }, [iconOf(item.capsule, `b${Date.now()}`)]),
      el('span', { text: item.capsule.textContent.trim() }),
      el('span', { class: 'orbit-back__swap', 'aria-hidden': 'true', text: '⟲' }),
    )
    back.style.setProperty('--planet-color', item.planet.style.getPropertyValue('--planet-color'))
  }

  const pick = async (item) => {
    if (!item || isBusy) return
    isBusy = true
    isRunning = false
    hapticImpact()
    const color = item.planet.style.getPropertyValue('--planet-color')
    overlay.style.setProperty('--pick-color', color)
    const toCore = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%) scale(0.2)`
    item.planet.style.zIndex = '4'
    leave(item.planet, [{}, { transform: toCore, opacity: 0 }], { duration: ms(380), easing: 'cubic-bezier(0.55, 0, 0.8, 0.2)' })
    allItems()
      .filter((other) => other !== item)
      .forEach((other) => {
        const away = `translate3d(${cx + (other.x - cx) * 2.4}px, ${cy + (other.y - cy) * 2.4}px, 0) translate(-50%, -50%) scale(0.6)`
        leave(other.planet, [{}, { transform: away, opacity: 0 }], { duration: ms(OUT_MS), easing: 'cubic-bezier(0.3, 0, 0.6, 1)' })
      })
    rings.forEach((ring) => leave(ring.el, [{}, { transform: 'scale(1.9)', opacity: 0 }], { duration: ms(OUT_MS), easing: 'ease-in' }))
    ;[title, hint].forEach((node) => leave(node, [{}, { opacity: 0, transform: 'translateY(-12px)' }], { duration: ms(300) }))
    const shock = el('span', { class: 'orbit__shock' })
    stage.append(shock)
    shock.animate([{ transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0.9 }, { transform: 'translate(-50%, -50%) scale(5)', opacity: 0 }], {
      duration: ms(700),
      delay: ms(300),
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
    }).finished.then(() => shock.remove())
    core.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: ms(420), delay: ms(300) })

    await wait(ms(380))
    onPick(item.capsule.dataset.product, item.capsule.dataset.service)
    setBackLabel(item)
    window.scrollTo(0, 0)
    await wait(ms(320))
    // аватар переезжает в шапку формы, небо гаснет — под ним уже форма выбранного сервиса
    const flight = leave(core, [{ transform: 'none' }, { transform: flightToHero(), opacity: 0.9 }], {
      duration: ms(FLIGHT_MS),
      easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
    })
    leave(backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: ms(FLIGHT_MS), easing: 'ease-in-out' })
    await flight.finished
    overlay.hidden = true
    document.documentElement.classList.remove('orbit-open')
    isBusy = false
  }

  const open = async (isFirst) => {
    if (isBusy) return
    isBusy = true
    overlay.hidden = false
    document.documentElement.classList.add('orbit-open')
    clearTraces()
    build()
    layout()
    run()
    const fromHero = isFirst ? 'scale(0.6)' : flightToHero()
    core.animate([{ transform: fromHero, opacity: 0.9 }, { transform: 'none', opacity: 1 }], { duration: ms(isFirst ? IN_MS : FLIGHT_MS), easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
    backdrop.animate([{ opacity: isFirst ? 1 : 0 }, { opacity: 1 }], { duration: ms(360), easing: 'ease-out' })
    rings.forEach((ring, index) =>
      ring.el.animate([{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
        duration: ms(IN_MS + index * 120),
        delay: ms(120),
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'backwards',
      }),
    )
    // сервисы вылетают из аватара на свои орбиты
    allItems().forEach((item, index) => {
      item.planet.querySelector('.orbit__label').animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: ms(300),
        delay: ms(IN_MS + index * 35),
        fill: 'backwards',
      })
      item.planet.querySelector('.orbit__body').animate([{ transform: `translate(${cx - item.x}px, ${cy - item.y}px) scale(0.2)`, opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: ms(IN_MS + 200),
        delay: ms(160 + index * 35),
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'backwards',
      })
    })
    ;[title, hint].forEach((node) => node.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: ms(IN_MS), delay: ms(200), fill: 'backwards' }))
    await wait(ms(IN_MS))
    isBusy = false
  }

  back.addEventListener('click', () => open(false))
  new MutationObserver(build).observe(productsEl, { childList: true })
  new ResizeObserver(() => layout()).observe(stage)
  window.addEventListener('resize', () => paintSky(sky))
  open(true)
}

const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
