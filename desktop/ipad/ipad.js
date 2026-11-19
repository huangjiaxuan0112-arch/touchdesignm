const loginPanel = document.querySelector('#login-panel')
const controlPanel = document.querySelector('#control-panel')
const loginForm = document.querySelector('#login-form')
const passwordInput = document.querySelector('#password')
const loginError = document.querySelector('#login-error')
const selectionError = document.querySelector('#selection-error')
const previewPlayButton = document.querySelector('#preview-play')
const phaseElement = document.querySelector('#phase')
const phaseDescription = document.querySelector('#phase-description')
const connection = document.querySelector('#connection')
const runtimeStatus = document.querySelector('#runtime-status')
const experienceButtons = [...document.querySelectorAll('[data-experience]')]
const preparing = document.querySelector('#preparing')
const preparingStage = preparing.querySelector('.nt-preparing__stage')
const preparingTitle = preparing.querySelector('.nt-preparing__heading')
const preparingModes = { WIND: '風', WAVE: '波', BUBBLE: '泡' }

const phaseCopy = {
  READY: ['準備完了', '次の体験を選べます。'],
  STARTING: ['開始準備中', '体験の準備中です。しばらくお待ちください。'],
  WAITING: ['体験準備中', 'まもなく体験が始まります。'],
  EXPERIENCE: ['体験中', '体験中です。終了までそのままお待ちください。'],
  AWAIT_COMPLETION: ['完了確認中', 'Windows パソコンで完了を確認しています。'],
  COOLDOWN: ['クールダウン', '体験が終了しました。次の準備をしています。'],
  FAULT: ['停止中', '現在、体験を利用できません。スタッフにお声がけください。'],
}
let latestRevision = -1
let eventStream
let latestSnapshot
let networkConnected = false
let selectionPending = false

function updateControls() {
  connection.textContent = networkConnected ? 'ネットワークに接続しました' : '接続が切れました。再接続しています…'
  experienceButtons.forEach(button => {
    button.disabled = !networkConnected || selectionPending || latestSnapshot?.phase !== 'READY' || latestSnapshot?.canSelect !== true
  })
}

function showLogin(message = '') {
  if (eventStream) eventStream.close()
  stopCarousel()
  eventStream = undefined
  networkConnected = false
  selectionPending = false
  latestSnapshot = undefined
  lastRenderedPhase = undefined
  carouselPausedByTouch = false
  delete document.body.dataset.phase
  delete document.body.dataset.selectable
  latestRevision = -1
  runtimeStatus.textContent = 'Windows の認証状態を待っています'
  updateControls()
  loginPanel.hidden = false
  controlPanel.hidden = true
  preparing.hidden = true
  loginError.textContent = message
  passwordInput.value = ''
}

function render(snapshot) {
  if (!snapshot || !Number.isInteger(snapshot.revision) || snapshot.revision < latestRevision) return
  if (!Object.hasOwn(phaseCopy, snapshot.phase)) return
  latestRevision = snapshot.revision
  const previousPhase = lastRenderedPhase
  lastRenderedPhase = snapshot.phase
  document.body.dataset.phase = snapshot.phase
  document.body.dataset.selectable = String(snapshot.canSelect === true)
  if (snapshot.phase === 'READY' && previousPhase !== 'READY') carouselPausedByTouch = false
  latestSnapshot = snapshot
  const [label, description] = phaseCopy[snapshot.phase]
  phaseElement.textContent = label
  phaseDescription.textContent = description
  const preparingMode = snapshot.phase === 'WAITING' && preparingModes[snapshot.experienceId]
  if (preparingMode) {
    preparingStage.dataset.mode = snapshot.experienceId.toLowerCase()
    preparingTitle.textContent = `${preparingMode}の体験を準備しています。`
  }
  if (preparing.hidden === Boolean(preparingMode)) preparing.hidden = !preparingMode
  if (snapshot.runtimeMode === 'mock' && snapshot.deviceSource === 'mock') {
    runtimeStatus.textContent = 'デモモード · 実機は動作しません'
  } else if (snapshot.runtimeMode === 'exhibition' && snapshot.deviceSource === 'firmware') {
    const connected = snapshot.device?.connectionState === 'connected'
    const verified = connected && snapshot.device?.verified === true
    runtimeStatus.textContent = '展示モード · ' + (verified
      ? `実機確認済み · ${snapshot.device.state}`
      : connected ? '実機の認証に失敗しました' : '実機に接続されていません')
    if (snapshot.phase === 'READY' && !snapshot.canSelect) {
      phaseDescription.textContent = '実機の準備ができていないため、まだ選択できません。'
    }
  } else {
    runtimeStatus.textContent = '状態を確認できません。Windows パソコンを確認してください。'
    latestSnapshot = { ...snapshot, canSelect: false }
  }
  experienceButtons.forEach(button => {
    const active = button.dataset.experience === snapshot.experienceId
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  updateControls()
  syncCarousel({ reset: snapshot.phase === 'READY' && previousPhase !== 'READY' })
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP_${response.status}`)
    error.status = response.status
    throw error
  }
  return payload
}

async function connect() {
  const snapshot = await request('/api/state')
  loginPanel.hidden = true
  controlPanel.hidden = false
  render(snapshot)
  if (eventStream) eventStream.close()
  eventStream = new EventSource('/api/events', { withCredentials: true })
  eventStream.addEventListener('snapshot', event => {
    try { render(JSON.parse(event.data)) } catch {
      networkConnected = false
      updateControls()
      connection.textContent = '状態データを読み取れません'
    }
  })
  eventStream.onopen = () => { networkConnected = true; updateControls(); syncCarousel() }
  eventStream.onerror = () => {
    networkConnected = false
    updateControls()
    syncCarousel()
    void request('/api/state').then(render).catch(error => {
      if (error.status === 401) showLogin('セッションの有効期限が切れました。再度ログインしてください。')
    })
  }
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault()
  loginError.textContent = ''
  try {
    await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password: passwordInput.value }),
    })
    await connect()
  } catch (error) {
    const message = error.status === 429
      ? '試行回数が上限に達しました。しばらくしてから再度お試しください。'
      : error.status === 401
        ? 'パスワードが正しくありません。'
        : 'Windows パソコンに接続できません。ネットワークと証明書を確認してください。'
    loginError.textContent = message
  } finally {
    passwordInput.value = ''
  }
})

experienceButtons.forEach(button => {
  button.addEventListener('click', async () => {
    if (button.disabled) return
    selectionPending = true
    carouselPausedByTouch = true
    stopCarousel()
    updateControls()
    selectionError.textContent = ''
    try {
      const result = await request('/api/select', {
        method: 'POST',
        body: JSON.stringify({ experienceId: button.dataset.experience }),
      })
      if (result.snapshot) render(result.snapshot)
    } catch (error) {
      if (error.status === 401) {
        showLogin('セッションの有効期限が切れました。再度ログインしてください。')
        return
      }
      selectionError.textContent = error.status === 409
        ? '体験中またはクールダウン中です。選択画面に戻るまでお待ちください。'
        : error.message === 'DEVICE_UNAVAILABLE'
          ? 'Windows には接続しましたが、実機の準備ができていません。スタッフにお声がけください。'
        : '選択を送信できません。Windows パソコンとの接続を確認してください。'
      void request('/api/state').then(render).catch(() => {})
    } finally {
      carouselPausedByTouch = false
      selectionPending = false
      updateControls()
      syncCarousel()
    }
  })
})

const carouselOrder = ['WAVE', 'BUBBLE', 'WIND']
const carouselFadeMs = 1200
const carouselStillMs = 300
const carouselTimeoutMs = 15000
const reducedMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
// Reuse the same media element across clips so a tap can enable the whole reel.
const previewVideo = document.createElement('video')
previewVideo.className = 'card-preview'
previewVideo.setAttribute('aria-hidden', 'true')
previewVideo.setAttribute('playsinline', '')
previewVideo.setAttribute('muted', '')
previewVideo.playsInline = true
previewVideo.defaultMuted = true
previewVideo.muted = true
previewVideo.preload = 'auto'

let carouselIndex = 0
let carouselTimer
let carouselRunning = false
let carouselPausedByTouch = false
let lastRenderedPhase
let previewNeedsTap = false
let failedPreviews = 0
let cancelPreviewListeners

function clearCarouselTimer() {
  clearTimeout(carouselTimer)
  carouselTimer = undefined
}

function stopCarousel() {
  carouselRunning = false
  clearCarouselTimer()
  cancelPreviewListeners?.()
  cancelPreviewListeners = undefined
  experienceButtons.forEach(button => button.classList.remove('is-preview-playing'))
  previewVideo.classList.remove('is-playing', 'is-loading')
  previewVideo.pause()
  previewPlayButton.hidden = true
}

function showCarouselPreview() {
  const activeId = carouselOrder[carouselIndex]
  const card = experienceButtons.find(button => button.dataset.experience === activeId)
  const listeners = new AbortController()
  const options = { signal: listeners.signal }
  cancelPreviewListeners = () => listeners.abort()
  let finishing = false

  function finish(reason) {
    if (finishing || listeners.signal.aborted) return
    finishing = true
    listeners.abort()
    clearCarouselTimer()
    const wasVisible = previewVideo.classList.contains('is-playing')
    card.classList.remove('is-preview-playing')
    previewVideo.classList.remove('is-playing', 'is-loading')
    failedPreviews = reason ? failedPreviews + 1 : 0

    if (reason === 'NotAllowedError' || failedPreviews >= carouselOrder.length) {
      stopCarousel()
      previewNeedsTap = true
      previewPlayButton.hidden = false
      return
    }

    const fade = wasVisible && !reducedMotionPreference.matches ? carouselFadeMs : 0
    carouselTimer = setTimeout(() => {
      previewVideo.pause()
      carouselIndex = (carouselIndex + 1) % carouselOrder.length
      showCarouselPreview()
    }, fade + carouselStillMs)
  }

  function watchPlayback() {
    if (finishing || listeners.signal.aborted) return
    clearCarouselTimer()
    carouselTimer = setTimeout(() => finish('timeout'), carouselTimeoutMs)
  }

  card.querySelector('img').after(previewVideo)
  previewVideo.classList.add('is-loading')
  previewVideo.addEventListener('ended', () => {
    if (previewVideo.ended) finish()
  }, options)
  previewVideo.addEventListener('error', () => {
    if (previewVideo.error) finish('media error')
  }, options)
  previewVideo.addEventListener('timeupdate', watchPlayback, options)
  previewVideo.src = card.dataset.previewSrc
  watchPlayback()
  void previewVideo.play().then(() => {
    if (listeners.signal.aborted) return
    card.classList.add('is-preview-playing')
    previewVideo.classList.replace('is-loading', 'is-playing')
    watchPlayback()
  }).catch(error => finish(error.name))
}

function syncCarousel({ reset = false, fromTap = false } = {}) {
  const canPreview = !document.hidden && !controlPanel.hidden &&
    ['READY', 'FAULT'].includes(latestSnapshot?.phase) && !selectionPending && !carouselPausedByTouch
  if (!canPreview || reset) stopCarousel()
  if (reset) {
    carouselIndex = 0
    failedPreviews = 0
  }
  if (!canPreview || carouselRunning) return
  if (!fromTap && (previewNeedsTap || reducedMotionPreference.matches)) {
    previewPlayButton.hidden = false
    return
  }
  previewNeedsTap = false
  previewPlayButton.hidden = true
  carouselRunning = true
  showCarouselPreview()
}

previewPlayButton.addEventListener('click', () => {
  failedPreviews = 0
  syncCarousel({ fromTap: true })
})
document.addEventListener('visibilitychange', () => syncCarousel())
reducedMotionPreference.addEventListener('change', () => {
  stopCarousel()
  syncCarousel()
})

void connect().catch(error => {
  if (error.status !== 401) connection.textContent = 'ログインをお待ちください'
})
