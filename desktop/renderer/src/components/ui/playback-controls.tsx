import type { ComponentProps, ReactNode } from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

// shadcn/ui's Radix composition, with local CSS instead of a Tailwind setup.
export function Button({ className = '', type = 'button', ...props }: ComponentProps<'button'>) {
  return <button type={type} className={`playback-button ${className}`} {...props} />
}

export function Slider(props: ComponentProps<typeof SliderPrimitive.Root>) {
  return <SliderPrimitive.Root className="playback-slider" {...props}>
    <SliderPrimitive.Track className="playback-slider__track">
      <SliderPrimitive.Range className="playback-slider__range" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="playback-slider__thumb" aria-label="音量" />
  </SliderPrimitive.Root>
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Content className="playback-tooltip" sideOffset={8}>
      {label}<TooltipPrimitive.Arrow />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Root>
}
export const TooltipProvider = TooltipPrimitive.Provider
