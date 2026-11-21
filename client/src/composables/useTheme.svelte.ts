import { onMount } from 'svelte'

type Theme = 'light' | 'dark'

export function useTheme() {
  let theme = $state<Theme>('light')

  const currentTheme = (): Theme => {
    const explicit = document.documentElement.dataset.theme
    if (explicit === 'dark' || explicit === 'light') return explicit
    if (typeof window.matchMedia !== 'function') return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  const setTheme = (target: Theme): void => {
    theme = target
    document.documentElement.dataset.theme = theme
    localStorage.setItem('scrub-theme', theme)
  }

  const toggleTheme = (): void => setTheme(currentTheme() === 'dark' ? 'light' : 'dark')

  onMount(() => {
    theme = currentTheme()
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const syncSystemTheme = (): void => {
      if (!document.documentElement.dataset.theme) theme = currentTheme()
    }

    media.addEventListener('change', syncSystemTheme)
    return () => media.removeEventListener('change', syncSystemTheme)
  })

  return {
    setTheme,
    toggleTheme,
    get theme() { return theme },
  }
}
