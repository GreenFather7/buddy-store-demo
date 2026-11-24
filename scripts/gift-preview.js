// Выбранный подарок в правой части строки ввода — со своей анимацией, как в мини-приложении звёзд.
// Анимации подарков — Lottie из сборки мини-приложения (assets/gifts/<id>.json), два новых — анимированные WebP.
// Проигрыватель lottie-web и анимации подгружаются заранее, как только открыт раздел (preload…),
// поэтому выбранный подарок сразу появляется анимированным.

const LOTTIE_URL = 'scripts/vendor/lottie_light.min.js?v=1795515899'
const LOTTIE_GIFT_IDS = new Set(Array.from({ length: 20 }, (_, index) => index + 1))
const IMAGE_GIFT_IDS = new Set([21, 22])
const giftJsonUrl = (giftId) => `assets/gifts/${giftId}.json`
const giftImageUrl = (giftId) => `assets/gifts/${giftId}.webp`

let lottieLoading = null

const loadLottie = () => {
  lottieLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = LOTTIE_URL
    script.addEventListener('load', () => resolve(window.lottie))
    script.addEventListener('error', () => reject(new Error('не загрузился проигрыватель анимаций')))
    document.head.append(script)
  })
  return lottieLoading
}

/** Загруженные анимации: адрес → обещание данных. Скачиваются один раз. */
const animationCache = new Map()

const loadAnimationData = (url) => {
  if (!animationCache.has(url)) {
    const request = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`анимация ${url}: ${response.status}`)
      return response.json()
    })
    // неудачную загрузку не запоминаем — при следующем выборе попробуем снова
    request.catch(() => animationCache.delete(url))
    animationCache.set(url, request)
  }
  // lottie-web меняет данные при запуске — каждому показу своя копия
  return animationCache.get(url).then((data) => structuredClone(data))
}

/** Заранее скачивает проигрыватель и анимации, чтобы выбранный вариант сразу двигался. */
export const preloadAnimations = (urls) => {
  loadLottie().catch(() => {})
  urls.forEach((url) => loadAnimationData(url).catch(() => {}))
}

/** То же для подарков: по номерам из списка подарков. */
export const preloadGifts = (giftIds) =>
  preloadAnimations(giftIds.map(Number).filter((id) => LOTTIE_GIFT_IDS.has(id)).map(giftJsonUrl))

/**
 * Проигрывает Lottie-анимацию из файла в контейнере (например, NFT-приз розыгрыша).
 * @returns {Promise<{ destroy: () => void } | null>} null — анимацию загрузить не удалось
 */
export const playLottie = async (container, url) => {
  try {
    const [lottie, animationData] = await Promise.all([loadLottie(), loadAnimationData(url)])
    return lottie.loadAnimation({ container, renderer: 'svg', loop: true, autoplay: true, animationData })
  } catch (error) {
    console.error(error) // анимация — украшение: остаётся картинка
    return null
  }
}

/**
 * @param {HTMLElement} slot место в строке ввода
 * @returns {{ show: (gift: { id: number, emoji: string }) => Promise<void>, clear: () => void }}
 */
export const createGiftPreview = (slot) => {
  let animation = null
  let wanted = null

  const clear = () => {
    animation?.destroy()
    animation = null
    slot.replaceChildren()
  }

  const showEmoji = (emoji) => {
    const fallback = document.createElement('span')
    fallback.className = 'gift-preview__emoji'
    fallback.textContent = emoji
    slot.replaceChildren(fallback)
  }

  return {
    clear() {
      wanted = null
      clear()
    },
    /**
     * Картинка, поверх которой запускается Lottie-анимация (например, коробка тарифа Premium).
     * @param {{ key: string, image: string, animation: string }} media
     */
    async showMedia(media) {
      wanted = media.key
      clear()
      const image = document.createElement('img')
      image.className = 'gift-preview__image'
      image.alt = ''
      image.src = media.image
      const stage = document.createElement('span')
      stage.className = 'gift-preview__stage gift-preview__stage--over'
      slot.replaceChildren(image, stage)
      const played = await playLottie(stage, media.animation)
      if (wanted !== media.key) {
        played?.destroy()
        return
      }
      if (played) {
        animation = played
        image.remove()
      }
    },
    async show(gift) {
      wanted = gift.id
      clear()
      const giftId = Number(gift.id)
      if (IMAGE_GIFT_IDS.has(giftId)) {
        const image = document.createElement('img')
        image.className = 'gift-preview__image'
        image.alt = ''
        image.src = giftImageUrl(giftId)
        image.addEventListener('error', () => wanted === gift.id && showEmoji(gift.emoji))
        slot.replaceChildren(image)
        return
      }
      // пока грузится анимация (или её нет для этого подарка) — показываем эмодзи
      showEmoji(gift.emoji)
      if (!LOTTIE_GIFT_IDS.has(giftId)) return
      try {
        const [lottie, animationData] = await Promise.all([loadLottie(), loadAnimationData(giftJsonUrl(giftId))])
        if (wanted !== gift.id) return // пока грузилось, выбрали другой подарок
        const stage = document.createElement('span')
        stage.className = 'gift-preview__stage'
        slot.replaceChildren(stage)
        animation = lottie.loadAnimation({ container: stage, renderer: 'svg', loop: true, autoplay: true, animationData })
      } catch (error) {
        console.error(error) // анимация — украшение: остаётся эмодзи, покупка работает
      }
    },
  }
}
