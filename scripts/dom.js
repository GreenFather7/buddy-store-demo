/**
 * Создаёт элемент. Текст всегда уходит через textContent/append — без innerHTML,
 * поэтому данные из API и из полей формы не могут стать разметкой.
 * @param {string} tag
 * @param {Record<string, unknown>} [props] class, text, dataset, on{Event}, остальные — атрибуты
 * @param {Array<Node|string|null|undefined|false>} [children]
 */
export const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag)
  Object.entries(props).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
    else node.setAttribute(key, value === true ? '' : value)
  })
  node.append(...children.filter(Boolean))
  return node
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const ICON_GRID = '0 0 24 24'

/** SVG-элемент с атрибутами и детьми — для значков, которые рисуются анимацией обводки. */
export const svgEl = (tag, attributes = {}, children = []) => {
  const node = document.createElementNS(SVG_NS, tag)
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value))
  node.append(...children)
  return node
}

/**
 * Логотип сервиса в сетке 24×24. Цвет берётся из CSS (currentColor), поэтому один
 * и тот же контур годится и для значка, и для водяного знака на карте.
 * @param {string} pathData атрибут d
 * @param {string} [className]
 */
export const logoIcon = (pathData, className) => {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', ICON_GRID)
  svg.setAttribute('aria-hidden', 'true')
  if (className) svg.setAttribute('class', className)
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', pathData)
  path.setAttribute('fill', 'currentColor')
  svg.append(path)
  return svg
}

/**
 * Карта сервиса: фирменный градиент и логотип-водяной знак. Цвета передаются
 * через CSS-переменные (CSSOM), а не атрибут style — так их не блокирует CSP.
 * @param {HTMLElement} node
 * @param {{from: string, to: string, path: string}} brand
 */
export const paintBrand = (node, brand) => {
  node.style.setProperty('--brand-from', brand.from)
  node.style.setProperty('--brand-to', brand.to)
  node.prepend(logoIcon(brand.path, 'brand-mark'))
  return node
}

/** Круглый флаг страны. Если файла для кода нет, картинка убирается, а не висит битой. */
export const flagImage = (url) => {
  const image = el('img', { class: 'flag', src: url, alt: '', width: '20', height: '20', loading: 'lazy' })
  image.addEventListener('error', () => image.remove())
  return image
}

const SAFE_LINK_PROTOCOLS = ['https:', 'ton:']

/** Адрес оплаты годится для ссылки только с https: или ton:. */
export const isSafeLink = (url) => {
  try {
    return SAFE_LINK_PROTOCOLS.includes(new URL(url).protocol)
  } catch {
    return false
  }
}

export const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false // нет доступа к буферу — текст всё равно выделяется нажатием
  }
}
