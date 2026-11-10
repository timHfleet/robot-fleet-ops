import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

const KEY = 'app-theme'

// In-app light/night mode toggle. Overrides the default theme (system or
// editor setting) and remembers the choice for future visits.
export default function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  // Apply any preference saved from a previous session.
  useEffect(() => {
    const stored = window.localStorage.getItem(KEY)
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.classList.toggle('dark', stored === 'dark')
      setDark(stored === 'dark')
    }
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      window.localStorage.setItem(KEY, next ? 'dark' : 'light')
    } catch {
      // Storage unavailable (e.g. blocked) — toggle still works for this session.
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to night mode'}
      title={dark ? 'Light mode' : 'Night mode'}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </button>
  )
}
