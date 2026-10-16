/**
 * 抽奖 3D 引擎
 *
 * 职责：
 *  - 初始化 Three CSS3D 名牌墙 / 名牌球与摄像机交互
 *  - 桌面(数字墙) / 球体两种形态切换的 Tween 动画
 *  - 抽奖流程时序：旋转 -> 停止 -> 抽选 -> 名牌前移出结果
 *  - 名牌卡片随机闪烁背景
 *
 * 边界：
 *  - 引擎内部创建的卡片 DOM 元素由 CSS3DRenderer 接管（style.transform 由 Three 写入），
 *    这部分不交给 Vue 模板渲染。
 *  - 展示类状态（按钮、奖品栏、气泡等）统一写入 store，由 Vue 组件响应。
 */
import { state, pushQipao } from './store.js'
import { NUMBER_MATRIX } from './config.js'
import { api } from '../api/index.js'
import { toUser, makeIntent } from '../lan-utils.mjs'

const ROTATE_TIME = 3000
const ROTATE_LOOP = 1000
const ROW_COUNT = 7
const COLUMN_COUNT = 17

let containerEl = null
let camera = null
let scene = null
let renderer = null
let controls = null
const threeDCards = []
const targets = { table: [], sphere: [] }
let rotateObj = null // 当前球体旋转 Tween
let selectedCardIndex = [] // 本次选中的卡片下标
let currentLuckys = [] // 本次选中的中奖人员
let HIGHLIGHT_CELL = [] // 高亮格子（年份数字图案）
let shineTimer = null // 卡片随机闪烁定时器
let rafId = null // requestAnimationFrame 句柄
let disposed = false

const random = num => Math.floor(Math.random() * num)
const curPrize = () => state.prizes.find(p => p.type === state.selectedPrizeType)

/* ============================ 生命周期 ============================ */

export function dispose() {
  disposed = true
  state.ready = false
  state.isLotting = false
  state.spinning = false
  if (rotateObj) rotateObj.stop()
  if (globalThis.TWEEN) TWEEN.removeAll()
  if (shineTimer) {
    clearInterval(shineTimer)
    shineTimer = null
  }
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  window.removeEventListener('resize', onWindowResize)
  if (controls && typeof controls.dispose === 'function') {
    controls.dispose()
  }
  if (containerEl) {
    containerEl.innerHTML = ''
  }
}

export async function boot(container) {
  dispose()
  disposed = false
  containerEl = container

  const snapshot = await api.status()
  applySnapshot(snapshot)
  state.currentTake = 0
  state.lastError = ''
  HIGHLIGHT_CELL = createHighlight()

  const valid = state.prizes.findIndex(p => p.type === state.selectedPrizeType)
  state.currentPrizeIndex = valid >= 0 ? valid : 0
  state.selectedPrizeType = state.prizes[state.currentPrizeIndex]?.type

  const showTable = state.leftUsers.length === state.users.length
  state.screen = showTable ? 'enter' : 'lottery'
  initCards(showTable)
  bootedInit()
}

function bootedInit() {
  window.addEventListener('resize', onWindowResize, false)
  startShineCard()
  animate()
  switchScreen()
  state.ready = true
}

/* ============================ 名牌初始化 ============================ */

function initCards(showTable) {
  const member = state.users.length ? state.users.slice() : [['—', '等待来宾报名', '扫码后加入名单']]
  const length = member.length

  // 重复初始化时先清空旧的卡片与目标位
  threeDCards.length = 0
  targets.table.length = 0
  targets.sphere.length = 0
  rotateObj = null
  selectedCardIndex = []
  currentLuckys = []

  let isBold = false
  let index = 0
  const position = {
    x: (140 * COLUMN_COUNT - 20) / 2,
    y: (180 * ROW_COUNT - 20) / 2
  }

  camera = new THREE.PerspectiveCamera(
    40,
    window.innerWidth / window.innerHeight,
    1,
    10000
  )
  camera.position.z = 3000

  scene = new THREE.Scene()

  for (let i = 0; i < ROW_COUNT; i++) {
    for (let j = 0; j < COLUMN_COUNT; j++) {
      isBold = HIGHLIGHT_CELL.includes(j + '-' + i)
      const element = createCard(member[index % length], isBold, index, showTable)

      const object = new THREE.CSS3DObject(element)
      object.position.x = Math.random() * 4000 - 2000
      object.position.y = Math.random() * 4000 - 2000
      object.position.z = Math.random() * 4000 - 2000
      scene.add(object)
      threeDCards.push(object)

      const target = new THREE.Object3D()
      target.position.x = j * 140 - position.x
      target.position.y = -(i * 180) + position.y
      targets.table.push(target)
      index++
    }
  }

  // sphere
  const vector = new THREE.Vector3()
  for (let i = 0, l = threeDCards.length; i < l; i++) {
    const phi = Math.acos(-1 + (2 * i) / l)
    const theta = Math.sqrt(l * Math.PI) * phi
    const object = new THREE.Object3D()
    object.position.setFromSphericalCoords(800, phi, theta)
    vector.copy(object.position).multiplyScalar(2)
    object.lookAt(vector)
    targets.sphere.push(object)
  }

  renderer = new THREE.CSS3DRenderer()
  renderer.setSize(window.innerWidth, window.innerHeight)
  containerEl.appendChild(renderer.domElement)

  controls = new THREE.TrackballControls(camera, renderer.domElement)
  controls.rotateSpeed = 0.5
  controls.minDistance = 500
  controls.maxDistance = 6000
  controls.addEventListener('change', render)
}

function createCard(user, isBold, id, showTable) {
  const element = createElement()
  element.id = 'card-' + id

  if (isBold) {
    element.className = 'element lightitem'
    if (showTable) {
      element.classList.add('highlight')
    }
  } else {
    element.className = 'element'
    element.style.backgroundColor =
      'rgba(0,127,127,' + (Math.random() * 0.7 + 0.25) + ')'
  }
  element.appendChild(createElement('company', state.COMPANY))
  element.appendChild(createElement('name', user[1]))
  element.appendChild(createElement('details', `${String(user[0]).slice(0, 8)}\n${user[2]}`))
  return element
}

function createElement(css, text) {
  const dom = document.createElement('div')
  dom.className = css || ''
  dom.textContent = text == null ? '' : String(text)
  return dom
}

/* ============================ 视图切换 ============================ */

function switchScreen(type = state.screen) {
  state.screen = type
  transform(type === 'enter' ? targets.table : targets.sphere, 2000)
}

function enter() {
  if (state.isLotting) {
    return
  }
  removeHighlight()
  pushQipao(`即将抽取${curPrize().text}，请留在现场。`)
  switchScreen('lottery')
}

// Backend snapshots are authoritative; animation never chooses winners.
export function applySnapshot(snapshot) {
  state.liveSnapshot = snapshot
  state.eventId = snapshot.event.id
  state.registrationOpen = snapshot.event.registrationOpen
  state.COMPANY = snapshot.event.title
  state.prizes = snapshot.prizes
  if (!state.prizes.some(p => p.type === state.selectedPrizeType)) state.selectedPrizeType = state.prizes[0]?.type
  state.currentPrizeIndex = state.prizes.findIndex(p => p.type === state.selectedPrizeType)
  state.EACH_COUNT = snapshot.prizes.map(p => p.perDraw)
  state.users = snapshot.participants.map(toUser)
  const won = new Set()
  state.luckyUsers = {}
  for (const round of snapshot.rounds) {
    const winners = round.winners.map(toUser)
    state.luckyUsers[round.prizeType] = (state.luckyUsers[round.prizeType] || []).concat(winners)
    winners.forEach(p => won.add(p[0]))
  }
  state.leftUsers = state.users.filter(p => !won.has(p[0]))
  state.lastRound = snapshot.rounds.at(-1) || null
}

async function startLottery() {
  if (state.registrationOpen) { state.lastError = '请先在管理页关闭报名并锁定名单'; return }
  if (!state.drawCount || !state.leftUsers.length) { state.lastError = '没有剩余可抽取人员或奖品名额'; return }
  state.lastError = ''
  state.pendingDraw = makeIntent(state.liveSnapshot.event, curPrize().type, state.drawCount)
  state.isLotting = true
  try { await resetCard(); if (!disposed) lottery() }
  catch (error) { state.isLotting = false; state.lastError = error.message }
}

function onLotteryClick() {
  if (state.spinning) stopRotate()
  else if (state.isLotting) return
  else if (state.pendingDraw) { state.isLotting = true; resolveDraw() }
  else startLottery()
}

function stopRotate() {
  state.spinning = false
  if (rotateObj) rotateObj.stop()
}

function lottery() {
  state.spinning = true
  rotateBall().then(() => { if (!disposed) resolveDraw() })
}

async function resolveDraw() {
  try {
    const result = await api.draw({ ...state.pendingDraw })
    if (disposed) return
    applySnapshot(result.snapshot)
    currentLuckys = result.round.winners.map(toUser)
    selectedCardIndex = []
    for (const user of currentLuckys) {
      let index = random(TOTAL_CARDS())
      while (selectedCardIndex.includes(index)) index = random(TOTAL_CARDS())
      selectedCardIndex.push(index)
    }
    state.pendingDraw = null
    state.currentTake = 0
    state.lastError = ''
    selectCard()
  } catch (error) {
    state.isLotting = false
    state.spinning = false
    if (error.status >= 400 && error.status < 500) {
      state.pendingDraw = null
      state.lastError = error.message
      try { applySnapshot(await api.status()) } catch { /* next poll reconnects */ }
    } else {
      state.lastError = `${error.message}。点击“重试开奖”将查询同一轮结果。`
      pushQipao('本轮尚未确认，请重试开奖')
    }
  }
}

function TOTAL_CARDS() {
  return ROW_COUNT * COLUMN_COUNT
}

/* ============================ 名牌卡操作 ============================ */

function removeHighlight() {
  threeDCards.forEach(item => {
    const el = item.element
    if (el && el.classList.contains('highlight')) {
      el.classList.remove('highlight')
    }
  })
}

function addHighlight() {
  threeDCards.forEach(item => {
    const el = item.element
    if (el && el.classList.contains('lightitem')) {
      el.classList.add('highlight')
    }
  })
}

function changeCard(cardIndex, user) {
  const card = threeDCards[cardIndex].element
  card.replaceChildren(createElement('company', state.COMPANY), createElement('name', user[1]), createElement('details', `${String(user[0]).slice(0, 8)}\n${user[2] || ''}`))
}

function shine(cardIndex, color) {
  const card = threeDCards[cardIndex].element
  card.style.backgroundColor =
    color || 'rgba(0,127,127,' + (Math.random() * 0.7 + 0.25) + ')'
}

/**
 * 随机切换名牌背景和人员信息
 */
function startShineCard() {
  if (shineTimer) {
    clearInterval(shineTimer)
  }
  shineTimer = setInterval(() => {
    // 正在抽奖停止闪烁
    if (state.isLotting || !state.leftUsers.length) {
      return
    }
    const maxUser = state.leftUsers.length
    const shineCard = 10 + random(10)
    for (let i = 0; i < shineCard; i++) {
      const index = random(maxUser)
      const cardIndex = random(TOTAL_CARDS())
      // 当前显示的已抽中名单不进行随机切换
      if (selectedCardIndex.includes(cardIndex)) {
        continue
      }
      shine(cardIndex)
      changeCard(cardIndex, state.leftUsers[index])
    }
  }, 500)
}

/* ============================ Tween 动画（原逻辑平移） ============================ */

function transform(target, duration) {
  for (let i = 0; i < threeDCards.length; i++) {
    const object = threeDCards[i]
    const t = target[i]
    if (!t) continue
    new TWEEN.Tween(object.position)
      .to(
        {
          x: t.position.x,
          y: t.position.y,
          z: t.position.z
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start()

    new TWEEN.Tween(object.rotation)
      .to(
        {
          x: t.rotation.x,
          y: t.rotation.y,
          z: t.rotation.z
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start()
  }

  new TWEEN.Tween({})
    .to({}, duration * 2)
    .onUpdate(render)
    .start()
}

function rotateBall() {
  return new Promise(resolve => {
    scene.rotation.y = 0
    rotateObj = new TWEEN.Tween(scene.rotation)
    rotateObj
      .to(
        {
          y: Math.PI * 6 * ROTATE_LOOP
        },
        ROTATE_TIME * ROTATE_LOOP
      )
      .onUpdate(render)
      .start()
      .onStop(() => {
        scene.rotation.y = 0
        resolve()
      })
      .onComplete(() => {
        resolve()
      })
  })
}

function selectCard(duration = 600) {
  const width = 140
  let tag = -(currentLuckys.length - 1) / 2
  const locates = []

  // 计算位置信息，大于 5 个分两排显示
  if (currentLuckys.length > 5) {
    const yPosition = [-87, 87]
    const l = selectedCardIndex.length
    const mid = Math.ceil(l / 2)
    tag = -(mid - 1) / 2
    for (let i = 0; i < mid; i++) {
      locates.push({
        x: tag * width,
        y: yPosition[0]
      })
      tag++
    }

    tag = -(l - mid - 1) / 2
    for (let i = mid; i < l; i++) {
      locates.push({
        x: tag * width,
        y: yPosition[1]
      })
      tag++
    }
  } else {
    for (let i = selectedCardIndex.length; i > 0; i--) {
      locates.push({
        x: tag * width,
        y: 0
      })
      tag++
    }
  }

  const text = currentLuckys.map(item => item[1])
  pushQipao(
    `恭喜${text.join('、')}获得${curPrize().text}！`
  )

  selectedCardIndex.forEach((cardIndex, index) => {
    changeCard(cardIndex, currentLuckys[index])
    const object = threeDCards[cardIndex]
    new TWEEN.Tween(object.position)
      .to(
        {
          x: locates[index].x,
          y: locates[index].y,
          z: 2200
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start()

    new TWEEN.Tween(object.rotation)
      .to(
        {
          x: 0,
          y: 0,
          z: 0
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start()

    object.element.classList.add('prize')
  })

  new TWEEN.Tween({})
    .to({}, duration * 2)
    .onUpdate(render)
    .start()
    .onComplete(() => {
      // 动画结束后可以操作
      state.isLotting = false
      state.spinning = false
    })
}

/**
 * 重置抽奖牌内容（回到球体）
 */
function resetCard(duration = 500) {
  if (currentLuckys.length === 0) {
    return Promise.resolve()
  }

  selectedCardIndex.forEach(index => {
    const object = threeDCards[index]
    const target = targets.sphere[index]
    if (!target) return
    new TWEEN.Tween(object.position)
      .to(
        {
          x: target.position.x,
          y: target.position.y,
          z: target.position.z
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start()

    new TWEEN.Tween(object.rotation)
      .to(
        {
          x: target.rotation.x,
          y: target.rotation.y,
          z: target.rotation.z
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start()
  })

  return new Promise(resolve => {
    new TWEEN.Tween({})
      .to({}, duration * 2)
      .onUpdate(render)
      .start()
      .onComplete(() => {
        selectedCardIndex.forEach(index => {
          const object = threeDCards[index]
          object.element.classList.remove('prize')
        })
        resolve()
      })
  })
}

/* ============================ 渲染循环 ============================ */

function animate() {
  if (disposed) {
    return
  }
  rafId = requestAnimationFrame(animate)
  TWEEN.update()
  if (controls) {
    controls.update()
  }
}

function render() {
  if (renderer && scene && camera) {
    renderer.render(scene, camera)
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  render()
}

function createHighlight() {
  const year = new Date().getFullYear() + ''
  const step = 4
  let xoffset = 1
  let yoffset = 1
  let highlight = []

  year.split('').forEach(n => {
    highlight = highlight.concat(
      NUMBER_MATRIX[n].map(item => {
        return `${item[0] + xoffset}-${item[1] + yoffset}`
      })
    )
    xoffset += step
  })
  return highlight
}

export const engine = { boot, dispose, enter, onLotteryClick, applySnapshot, isLotting: () => state.isLotting }
