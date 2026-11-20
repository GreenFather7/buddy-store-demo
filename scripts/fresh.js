// Хостинг и Telegram держат страницу в кэше по несколько минут, и после выкладки покупатель
// видит старую версию. Сборка помечается номером (<meta name="build"> и файл build.txt):
// если на сервере номер уже другой — страница один раз перезагружается с новым адресом.
// Без метки (локальный запуск) проверка не выполняется.

const BUILD_FILE = 'build.txt'
const BUILD_PARAM = 'b'
const RELOADED_KEY = 'buddy.build.reloaded'

export const ensureFreshBuild = async () => {
  const current = document.querySelector('meta[name="build"]')?.content
  if (!current) return
  try {
    const response = await fetch(`${BUILD_FILE}?t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return
    const latest = (await response.text()).trim()
    // второй раз на ту же версию не перезагружаемся — иначе при сбое кэша страница зациклится
    if (!/^\d+$/.test(latest) || latest === current || sessionStorage.getItem(RELOADED_KEY) === latest) return
    sessionStorage.setItem(RELOADED_KEY, latest)
    const url = new URL(window.location.href)
    url.searchParams.set(BUILD_PARAM, latest)
    window.location.replace(url)
  } catch {
    // нет сети или хранилища — остаёмся на текущей версии, магазин работает
  }
}
