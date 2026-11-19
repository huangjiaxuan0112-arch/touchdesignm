import { useEffect, useRef } from 'react'
import type { ExperienceControlState } from '../../../shared/experience-control-protocol'
import type { ExperienceId } from '../../../shared/experience-definitions'
import '../../../ipad/preparing-page.css'

const modes: Record<ExperienceId, { mode: 'wind' | 'wave' | 'bubble'; title: string }> = {
  WIND: { mode: 'wind', title: '風' },
  WAVE: { mode: 'wave', title: '波' },
  BUBBLE: { mode: 'bubble', title: '泡' },
}

export function PreparingPage({ id, backendState, backendReady, connectionReady }: {
  id: ExperienceId
  backendState: ExperienceControlState
  backendReady: boolean
  connectionReady: boolean
}) {
  const page = useRef<HTMLElement>(null)
  const { mode, title } = modes[id]

  useEffect(() => {
    page.current?.focus()
    // Main owns the WAITING deadline; this component only renders it.
  }, [])

  const message = !connectionReady
    ? 'デバイス接続を確認しています。'
    : backendState === 'FAULT'
      ? 'デバイスの異常を確認しました。体験は開始されません。'
      : backendState === 'STOPPING'
        ? '停止状態を確認しています。体験は開始されません。'
        : !backendReady
          ? 'バックエンドの準備を確認しています。'
          : ''

  return (
    <section ref={page} className="nt-preparing" role="dialog" aria-modal="true"
      aria-label={`${title}の体験を準備しています`} tabIndex={-1} data-preparing={id}>
      <main className="nt-preparing__wrap">
        <section className="nt-preparing__stage" data-mode={mode}
          aria-label="Nature Touch 等待页动态演示">
          <div className="nt-preparing__orb">
            <svg viewBox="0 0 420 240" role="presentation">
              <defs>
                <radialGradient id="nt-wind-fill" cx="38%" cy="28%" r="85%">
                  <stop offset="0" stopColor="#f6f4f1" /><stop offset=".48" stopColor="#e8e8e6" />
                  <stop offset=".81" stopColor="#d7dcdf" /><stop offset="1" stopColor="#cbd3d6" />
                </radialGradient>
                <linearGradient id="nt-wave-fill" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#d6e7ec" /><stop offset=".68" stopColor="#bcd5db" />
                  <stop offset="1" stopColor="#e5ded2" />
                </linearGradient>
                <radialGradient id="nt-bubble-fill" cx="41%" cy="36%" r="76%">
                  <stop offset="0" stopColor="#fafbfb" stopOpacity=".95" />
                  <stop offset=".7" stopColor="#e7ecee" stopOpacity=".76" />
                  <stop offset="1" stopColor="#d7e0e3" stopOpacity=".81" />
                </radialGradient>
                <linearGradient id="nt-bubble-rim" x1="0" y1="0" x2="1" y2=".7">
                  <stop stopColor="#bcd5de" stopOpacity=".5" /><stop offset=".3" stopColor="#e5cfdb" stopOpacity=".58" />
                  <stop offset=".64" stopColor="#d6e6df" stopOpacity=".55" /><stop offset="1" stopColor="#d4ddec" stopOpacity=".6" />
                </linearGradient>
                <linearGradient id="nt-warm-sheen" x1="0" x2="1">
                  <stop stopColor="#fff8ed" stopOpacity=".03" /><stop offset=".6" stopColor="#fff9ed" stopOpacity=".40" />
                  <stop offset="1" stopColor="#ffffff" stopOpacity=".05" />
                </linearGradient>
                <filter id="nt-blur"><feGaussianBlur stdDeviation="10" /></filter>
                <radialGradient id="nt-veil" cx="52%" cy="34%">
                  <stop stopColor="#ffffff" stopOpacity=".34" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" />
                </radialGradient>
              </defs>
              <ellipse cx="210" cy="124" rx="181" ry="107" fill="#d2dce1" opacity=".12" filter="url(#nt-blur)" />
              <g className="nt-preparing__breath">
                <g className="nt-preparing__ring" fill="none" stroke="#d4dfe3" strokeWidth="1.2">
                  <ellipse cx="210" cy="120" rx="188" ry="109" /><ellipse cx="210" cy="120" rx="174" ry="101" />
                </g>
                <g className="nt-preparing__modepart nt-preparing__wind">
                  <ellipse cx="210" cy="120" rx="157" ry="91" fill="url(#nt-wind-fill)" stroke="#cbd3d5" strokeWidth="1.3" />
                  <ellipse className="nt-preparing__wind-shine" cx="169" cy="75" rx="92" ry="31"
                    fill="url(#nt-warm-sheen)" filter="url(#nt-blur)" />
                </g>
                <g className="nt-preparing__modepart nt-preparing__wave">
                  <ellipse cx="210" cy="120" rx="157" ry="91" fill="url(#nt-wave-fill)" stroke="#b9cbd0" strokeWidth="1.3" />
                  <ellipse cx="157" cy="84" rx="80" ry="25" fill="#fff" opacity=".16" filter="url(#nt-blur)" />
                </g>
                <g className="nt-preparing__modepart nt-preparing__bubble">
                  <ellipse cx="210" cy="120" rx="156" ry="91" fill="url(#nt-bubble-fill)" stroke="url(#nt-bubble-rim)" strokeWidth="3" />
                  <ellipse cx="210" cy="120" rx="153" ry="88" fill="url(#nt-veil)" stroke="#fff" strokeWidth="1.25" opacity=".65" />
                </g>
              </g>
            </svg>
          </div>

          <div className="nt-preparing__words">
            <p className="nt-preparing__eyebrow">エアーを整えています</p>
            <h1 className="nt-preparing__heading">{title}の体験を準備しています。</h1>
            <p className="nt-preparing__sub">しばらくお待ちください。</p>
          </div>

          <div className="nt-preparing__progress">
            <svg viewBox="0 0 340 58" role="presentation">
              <g className="nt-preparing__modepart nt-preparing__wind">
                <path d="M8 29 H332" stroke="#dfe2e2" strokeWidth="1.45" fill="none" />
                <path className="nt-preparing__windgrow" pathLength={100} d="M8 29 H332"
                  stroke="#9bafb8" strokeWidth="1.9" strokeLinecap="butt" fill="none" />
                <g className="nt-preparing__windflow" fill="none" stroke="#bdccd0" strokeWidth=".8">
                  <path d="M6 24 C16 21 26 22 38 25" /><path d="M6 34 C18 35 28 34 41 31" />
                  <path d="M4 29 H28" />
                </g>
              </g>
              <g className="nt-preparing__modepart nt-preparing__wave">
                <path className="nt-preparing__wavegrow" pathLength={100}
                  d="M8 29 Q35 14 62 29 T116 29 T170 29 T224 29 T278 29 T332 29"
                  stroke="#8eacba" strokeWidth="2.1" strokeLinecap="round" fill="none" />
              </g>
            </svg>
          </div>

          <div className="nt-preparing__bubble-progress" aria-label="气泡依次出现的准备动画">
            <i className="nt-preparing__bubble-item nt-preparing__b1" />
            <i className="nt-preparing__bubble-item nt-preparing__b2" />
            <i className="nt-preparing__bubble-item nt-preparing__b3" />
            <i className="nt-preparing__bubble-item nt-preparing__b4" />
            <i className="nt-preparing__bubble-item nt-preparing__b5" />
          </div>
        </section>
        {message && <p className="nt-preparing__message" role="status" aria-live="polite">{message}</p>}
      </main>
    </section>
  )
}
