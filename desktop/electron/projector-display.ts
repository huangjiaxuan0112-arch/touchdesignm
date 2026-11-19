import type { Rectangle } from 'electron'

interface ProjectorDisplay { id: number; bounds: Rectangle; workArea: Rectangle }

export function rectanglesOverlap(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height
}

export function getProjectorPlacement(displays: readonly ProjectorDisplay[], primary: ProjectorDisplay,
  mainBounds: Rectangle): { bounds: Rectangle; fullscreen: boolean; mainBounds?: Rectangle } {
  const external = displays.find(display => display.id !== primary.id)
  if (external) return { bounds: { ...external.bounds }, fullscreen: true }

  const area = primary.workArea
  const width = Math.min(640, Math.floor(area.width * .38))
  const bounds = {
    x: area.x + area.width - width, y: area.y,
    width, height: Math.min(360, area.height),
  }
  // Tile only if necessary: a normal preview must not cover the control window.
  return {
    bounds, fullscreen: false,
    ...(rectanglesOverlap(bounds, mainBounds) ? { mainBounds: {
      x: area.x, y: area.y,
      width: Math.max(1, Math.min(mainBounds.width, area.width - width - 16)),
      height: Math.min(mainBounds.height, area.height),
    } } : {}),
  }
}
