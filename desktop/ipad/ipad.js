const loginPanel = document.querySelector('#login-panel')
const controlPanel = document.querySelector('#control-panel')
const loginForm = document.querySelector('#login-form')
const passwordInput = document.querySelector('#password')
const loginError = document.querySelector('#login-error')
const selectionError = document.querySelector('#selection-error')
const phaseElement = document.querySelector('#phase')
const phaseDescription = document.querySelector('#phase-description')
const connection = document.querySelector('#connection')
const experienceButtons = [...document.querySelectorAll('[data-experience]')]

const phaseCopy = {
  READY: ['READY', '可以选择下一种体验。'],
  STARTING: ['STARTING', '正在准备体验，请稍候。'],
  WAITING: ['WAITING', '请静候片刻，体验即将开始。'],
  EXPERIENCE: ['EXPERIENCE', '正在体验中，请等待自然完成。'],
  AWAIT_COMPLETION: ['EXPERIENCE', '正在等待 Windows 控制端确认完成。'],
  COOLDOWN: ['COOLDOWN', '体验已完成，正在准备下一轮。'],
  FAULT: ['FAULT', '体验暂时不可用，请联系现场工作人员。'],
}
let latestRevision = -1
let eventStream

function showLogin(message = '') {
  if (eventStream) eventStream.close()
  eventStream = undefined
  loginPanel.hidden = false
  controlPanel.hidden = true
  loginError.textContent = message
  passwordInput.value = ''
}

function render(snapshot) {
  if (!snapshot || !Number.isInteger(snapshot.revision) || snapshot.revision <= latestRevision) return
  if (!Object.hasOwn(phaseCopy, snapshot.phase)) return
  latestRevision = snapshot.revision
  const [label, description] = phaseCopy[snapshot.phase]
  phaseElement.textContent = label
  phaseDescription.textContent = description
  experienceButtons.forEach(button => {
    const active = button.dataset.experience === snapshot.experienceId
    button.disabled = snapshot.phase !== 'READY'
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-pressed', String(active))
  })
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
    try { render(JSON.parse(event.data)) } catch { connection.textContent = '状态数据无效' }
  })
  eventStream.onopen = () => { connection.textContent = '已连接' }
  eventStream.onerror = () => {
    connection.textContent = '连接中断，正在恢复…'
    void request('/api/state').then(render).catch(error => {
      if (error.status === 401) showLogin('会话已过期，请重新登录。')
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
      ? '尝试次数过多，请稍后再试。'
      : error.status === 401
        ? '密码错误。'
        : '无法连接 Windows 主机，请检查网络和 HTTPS 证书。'
    loginError.textContent = message
  } finally {
    passwordInput.value = ''
  }
})

experienceButtons.forEach(button => {
  button.addEventListener('click', async () => {
    if (button.disabled) return
    experienceButtons.forEach(candidate => { candidate.disabled = true })
    selectionError.textContent = ''
    try {
      await request('/api/select', {
        method: 'POST',
        body: JSON.stringify({ experienceId: button.dataset.experience }),
      })
    } catch (error) {
      if (error.status === 401) {
        showLogin('会话已过期，请重新登录。')
        return
      }
      selectionError.textContent = error.status === 409
        ? '已有体验正在进行或冷却中，请等待返回 READY。'
        : '无法提交选择，请确认 Windows 主机连接正常。'
      void request('/api/state').then(render).catch(() => {})
    }
  })
})

void connect().catch(error => {
  if (error.status !== 401) connection.textContent = '等待登录'
})
