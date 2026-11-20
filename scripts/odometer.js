// Сумма на кнопке оплаты как счётчик: цифры прокручиваются барабаном к новому значению,
// слово «Оплатить» при этом стоит на месте. Растёт сумма — цифры уезжают вверх, падает — вниз.

const DIGITS = '0123456789'

const isDigit = (char) => DIGITS.includes(char)
const digitsOf = (text) => [...text].filter(isDigit)
const numberOf = (text) => Number(digitsOf(text).join('')) || 0

/** Колонка 0–9, сдвинутая к цифре digit (стили — .odo-digit / .odo-strip). */
const digitCell = (digit, order) => {
  const strip = document.createElement('span')
  strip.className = 'odo-strip'
  // каждая цифра — отдельная строка фиксированной высоты: на iPhone строки текста
  // с переносами выходили другой высоты, и цифры сидели криво
  strip.append(...DIGITS.split('').map((digit) => {
    const line = document.createElement('span')
    line.textContent = digit
    return line
  }))
  strip.style.setProperty('--digit', String(digit))
  strip.style.setProperty('--order', String(order))
  const cell = document.createElement('span')
  cell.className = 'odo-digit'
  cell.dataset.digit = DIGITS[digit]
  cell.append(strip)
  return cell
}

const charCell = (char) => {
  const cell = document.createElement('span')
  cell.className = 'odo-char'
  cell.textContent = char
  return cell
}

/**
 * Показывает новую сумму. Цифры, совпадающие по разряду со старой суммой, прокручиваются от
 * прежнего значения; новые разряды выезжают от нуля (или от девяти, если сумма уменьшилась).
 * @param {HTMLElement} container
 * @param {string} text например «1 750 ₽» или «0.413 TON»
 * @param {boolean} isAnimated
 */
export const setAmount = (container, text, isAnimated) => {
  const previous = container.dataset.value ?? ''
  if (previous === text) return
  container.dataset.value = text
  const isUp = numberOf(text) >= numberOf(previous)
  const oldDigits = digitsOf(previous)
  const newDigits = digitsOf(text)
  // разряды сопоставляем справа: единицы с единицами, десятки с десятками
  const startDigit = (indexFromRight) => {
    const old = oldDigits[oldDigits.length - 1 - indexFromRight]
    if (old !== undefined) return Number(old)
    return isUp ? 0 : 9
  }
  let digitIndex = newDigits.length
  const cells = [...text].map((char) => {
    if (!isDigit(char)) return charCell(char)
    digitIndex -= 1
    const target = Number(char)
    const from = isAnimated ? startDigit(digitIndex) : target
    // единицы трогаются первыми, старшие разряды — следом
    return { cell: digitCell(from, digitIndex), target }
  })
  container.replaceChildren(...cells.map((item) => (item instanceof Node ? item : item.cell)))
  if (!isAnimated) return
  // двойной кадр: сначала браузер рисует старые цифры, затем прокручивает к новым
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      cells.forEach((item) => {
        if (item instanceof Node) return
        item.cell.firstChild.style.setProperty('--digit', String(item.target))
      }),
    ),
  )
}
