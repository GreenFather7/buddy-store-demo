// Тестовый режим (?demo=1): виртуальный баланс и окно тестовой оплаты вместо платёжки.
// В окне выбирается, чем закончится заказ, — так проверяются все экраны после оплаты.
// В боевом режиме модуль не используется.

import { el, textWithIcons } from './dom.js?v=1795439404'
import { formatRub } from './lib.js?v=1795439404'

const BALANCE_KEY = 'buddy.test.balance'
const START_BALANCE = 100000

/** Исходы оплаты; спишется ли тестовый баланс. */
const OUTCOMES = [
  { id: 'success', title: 'Оплатить', note: 'всё пройдёт успешно', isPaid: true, className: 'btn--gold' },
  { id: 'declined', title: 'Платёж не прошёл', note: 'деньги не спишутся', isPaid: false },
  { id: 'failed', title: 'Ошибка выдачи', note: 'оплачено, но заказ не выполнен', isPaid: true },
  { id: 'delayed', title: 'Выдача задерживается', note: 'оплачено, ждём поставщика', isPaid: true },
]

let memoryBalance = START_BALANCE

export const getBalance = () => {
  try {
    const stored = Number(localStorage.getItem(BALANCE_KEY))
    return Number.isFinite(stored) && localStorage.getItem(BALANCE_KEY) !== null ? stored : memoryBalance
  } catch {
    return memoryBalance
  }
}

const setBalance = (value) => {
  memoryBalance = value
  try {
    localStorage.setItem(BALANCE_KEY, String(value))
  } catch {
    // без хранилища баланс живёт до перезагрузки страницы
  }
  document.dispatchEvent(new CustomEvent('testbalance'))
}

/** Сумма в рублях из текста цены («1 750 ₽» → 1750); у USDT и TON считаем по рублёвой цене. */
const rubles = (text) => Number(String(text ?? '').replace(/[^\d]/g, '')) || 0

/**
 * Строка с тестовым балансом под кнопкой оплаты. Нажатие возвращает баланс к стартовому.
 * @param {HTMLElement} anchor после какого элемента поставить строку
 */
export const mountBalance = (anchor) => {
  const amount = el('strong', {})
  const line = el(
    'button',
    {
      class: 'test-balance',
      type: 'button',
      title: 'Вернуть стартовый баланс',
      onClick: () => setBalance(START_BALANCE),
    },
    [el('span', { text: 'Тестовый баланс ' }), amount, el('span', { class: 'test-balance__reset', text: '↺' })],
  )
  const update = () => {
    amount.textContent = formatRub(getBalance())
  }
  update()
  document.addEventListener('testbalance', update)
  anchor.after(line)
}

/**
 * Окно тестовой оплаты.
 * @param {{ priceText: string, rubText: string, title: string }} payment
 * @returns {Promise<'success'|'declined'|'failed'|'delayed'|null>} null — покупатель закрыл окно
 */
export const askTestPayment = ({ priceText, rubText, title }) =>
  new Promise((resolve) => {
    const cost = rubles(rubText)
    const balance = getBalance()
    const isShort = cost > balance

    const finish = (outcome) => {
      document.removeEventListener('keydown', onKey)
      sheet.classList.add('test-sheet--closing')
      sheet.addEventListener('animationend', () => sheet.remove(), { once: true })
      const chosen = OUTCOMES.find((item) => item.id === outcome)
      if (chosen?.isPaid) setBalance(balance - cost)
      resolve(outcome)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') finish(null)
    }

    const buttons = OUTCOMES.map((outcome) =>
      el(
        'button',
        {
          class: `btn test-sheet__option ${outcome.className ?? 'btn--ghost'}`,
          type: 'button',
          disabled: outcome.isPaid && isShort,
          onClick: () => finish(outcome.id),
        },
        [el('span', { text: outcome.title }), el('small', { text: outcome.note })],
      ),
    )

    const sheet = el('div', { class: 'test-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Тестовая оплата' }, [
      el('div', { class: 'test-sheet__backdrop', onClick: () => finish(null) }),
      el('div', { class: 'test-sheet__panel' }, [
        el('p', { class: 'test-sheet__badge', text: 'Тестовая оплата' }),
        el('p', { class: 'test-sheet__title' }, textWithIcons(title)),
        el('p', { class: 'test-sheet__price', text: priceText }),
        el('p', {
          class: `test-sheet__balance${isShort ? ' test-sheet__balance--short' : ''}`,
          text: isShort
            ? `Не хватает: на балансе ${formatRub(balance)}`
            : `С баланса ${formatRub(balance)} спишется ${formatRub(cost)}`,
        }),
        ...buttons,
        el('button', { class: 'test-sheet__cancel', type: 'button', text: 'Не оплачивать', onClick: () => finish(null) }),
      ]),
    ])
    document.addEventListener('keydown', onKey)
    document.body.append(sheet)
    buttons[0].focus({ preventScroll: true })
  })
