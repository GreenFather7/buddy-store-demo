// Перебор символов кода гифт-карты: пока код выпускается, символы непрерывно перебираются;
// когда код готов, они по очереди слева направо встают на свои места.
// Анимации сами останавливаются, когда элемент убрали со страницы.

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
const FRAME_MS = 55
const REVEAL_MS = 1100
const PLACEHOLDER = 'XXXX-XXXX-XXXX-XXXX'

const prefersLessMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const randomChar = () => CHARSET[Math.floor(Math.random() * CHARSET.length)]
/** Буквы и цифры заменяются случайными, дефисы и пробелы остаются. */
const scrambled = (pattern) => [...pattern].map((char) => (/[A-Za-z0-9]/.test(char) ? randomChar() : char)).join('')

/** Перебор без конца — пока код не готов. */
export const startScramble = (node, pattern = PLACEHOLDER) => {
  node.textContent = scrambled(pattern)
  if (prefersLessMotion()) return
  const timer = setInterval(() => {
    if (!node.isConnected) {
      clearInterval(timer)
      return
    }
    node.textContent = scrambled(pattern)
  }, FRAME_MS)
}

/** Код «проявляется»: символы слева направо перестают перебираться и встают на место. */
export const revealCode = (node, code, onDone) => {
  if (prefersLessMotion()) {
    node.textContent = code
    onDone?.()
    return
  }
  const started = performance.now()
  const chars = [...code]
  const tick = (now) => {
    if (!node.isConnected) return
    const settled = Math.floor(((now - started) / REVEAL_MS) * chars.length)
    node.textContent = chars
      .map((char, index) => (index < settled || !/[A-Za-z0-9]/.test(char) ? char : randomChar()))
      .join('')
    if (settled < chars.length) {
      requestAnimationFrame(tick)
      return
    }
    node.textContent = code
    onDone?.()
  }
  requestAnimationFrame(tick)
}
