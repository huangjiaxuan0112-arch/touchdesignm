export interface ExperienceClock {
  now(): number
  schedule(callback: () => void, delayMs: number): () => void
}

export const systemExperienceClock: ExperienceClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs)
    return () => clearTimeout(timer)
  },
}