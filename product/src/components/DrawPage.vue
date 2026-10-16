<template>
  <main class="lan-draw">
    <StarCanvas /><div id="container" ref="containerRef"></div>
    <header class="draw-header"><a href="/">← 返回名单管理</a><div><span class="draw-kicker">幸运就在此刻</span><h1>{{ snapshot?.event.title || '现场幸运抽奖' }}</h1></div><button @click="fullscreen">{{ isFullscreen ? '退出全屏' : '全屏展示' }}</button></header>
    <div v-if="error || state.lastError" class="draw-error" role="alert">{{ error || state.lastError }}</div>
    <aside v-if="snapshot" class="draw-sidebar"><span class="draw-kicker">本次奖项</span><article v-for="p in snapshot.prizes" :key="p.type" :class="['draw-prize', { active: p.type === selectedType }]"><h2>{{ p.text }}</h2><p>{{ p.title || '幸运礼品' }}</p><span>{{ remaining(p) }} / {{ p.count }} 个名额剩余</span></article><div class="draw-counts">参与 {{ snapshot.participants.length }} 人<br />尚未中奖 {{ snapshot.availableCount }} 人</div></aside>
    <aside v-if="lastRound" class="winner-panel"><span class="draw-kicker">{{ state.isLotting ? '上轮中奖' : '恭喜中奖' }}</span><h2>{{ lastRound.prizeName }}</h2><div v-for="p in lastRound.winners" :key="p.id" class="winner-name"><strong>{{ p.name }}</strong><span>{{ p.id.slice(0, 8) }} · {{ maskPhone(p.phone) }}</span></div><p>结果已保存</p><a href="/api/admin/export?kind=winners">导出中奖记录 ↗</a></aside>
    <section v-if="snapshot" class="draw-controls">
      <p v-if="snapshot.event.registrationOpen" class="draw-notice">报名仍在进行，请先返回管理页关闭报名。</p>
      <p v-else-if="!limit && !state.pendingDraw" class="draw-notice">{{ snapshot.availableCount ? '当前奖项已抽完，请选择其它奖项。' : '所有参与者都已中奖。' }}</p>
      <div class="draw-options"><label>奖项<select v-model.number="selectedType" :disabled="state.isLotting || !!state.pendingDraw"><option v-for="p in snapshot.prizes" :key="p.type" :value="p.type">{{ p.text }}</option></select></label><label>本轮人数<select v-model.number="state.drawCount" :disabled="state.isLotting || !!state.pendingDraw || !limit"><option v-for="n in limit" :key="n" :value="n">{{ n }} 人</option><option v-if="!limit" :value="0">0 人</option></select></label><button class="draw-main-button" :disabled="buttonDisabled" @click="engine.onLotteryClick">{{ state.spinning ? '停止并开奖' : state.isLotting ? '开奖中…' : state.pendingDraw ? '重试开奖' : '开始抽奖' }}</button></div>
      <span class="draw-footnote">中奖者不再参加其它奖项 · 开奖结果立即保存</span>
    </section><QipaoList /><MusicControl />
  </main>
</template>
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import StarCanvas from './StarCanvas.vue'
import QipaoList from './QipaoList.vue'
import MusicControl from './MusicControl.vue'
import { engine } from '../lottery/engine.js'
import { state } from '../lottery/store.js'
import { api } from '../api/index.js'
import { maskPhone, drawLimit } from '../lan-utils.mjs'
const containerRef = ref(null), selectedType = ref(null), error = ref(''), isFullscreen = ref(false)
const snapshot = computed(() => state.liveSnapshot), lastRound = computed(() => state.lastRound)
const selectedPrize = computed(() => snapshot.value?.prizes.find(p => p.type === selectedType.value))
const limit = computed(() => drawLimit(snapshot.value, selectedPrize.value))
const buttonDisabled = computed(() => !state.ready || !!error.value || (state.isLotting && !state.spinning) || snapshot.value?.event.registrationOpen || (!limit.value && !state.pendingDraw))
let timer, refreshing = false, signature = ''
function remaining(p) { return p.count - snapshot.value.rounds.filter(r => r.prizeType === p.type).reduce((sum,r) => sum + r.winners.length, 0) }
watch(selectedType, type => { state.selectedPrizeType = type; state.currentPrizeIndex = state.prizes.findIndex(p => p.type === type); state.drawCount = Math.min(selectedPrize.value?.perDraw || 1, limit.value) })
watch(limit, max => { if (!state.isLotting && !state.pendingDraw && (state.drawCount > max || state.drawCount < 1)) state.drawCount = Math.min(selectedPrize.value?.perDraw || 1, max) })
async function refresh() {
  if (refreshing || state.isLotting || state.pendingDraw) return
  refreshing = true
  try {
    const data = await api.status()
    if (state.isLotting || state.pendingDraw) return
    const next = `${data.event.id}:${data.event.drawGeneration}:${data.participants.map(p => p.id).join(',')}`
    if (!state.ready || signature !== next) { await engine.boot(containerRef.value); engine.enter() }
    else engine.applySnapshot(data)
    signature = next
    if (!data.prizes.some(p => p.type === selectedType.value)) selectedType.value = data.prizes.find(p => drawLimit(data,p) > 0)?.type || data.prizes[0]?.type
    error.value = ''
  } catch (err) { error.value = err.message }
  finally { refreshing = false }
}
async function fullscreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen() }
  catch { error.value = '浏览器暂时无法全屏，请使用 F11 或继续当前窗口。' }
}
function fullscreenChanged() { isFullscreen.value = !!document.fullscreenElement }
function keyboard(event) {
  if (event.code !== 'Space' || event.repeat || ['INPUT','SELECT','TEXTAREA','BUTTON'].includes(event.target.tagName)) return
  event.preventDefault(); if (!buttonDisabled.value) engine.onLotteryClick()
}
onMounted(async () => {
  document.addEventListener('fullscreenchange', fullscreenChanged); window.addEventListener('keydown', keyboard)
  try { await engine.boot(containerRef.value); engine.enter(); signature = `${snapshot.value.event.id}:${snapshot.value.event.drawGeneration}:${snapshot.value.participants.map(p => p.id).join(',')}`; selectedType.value = snapshot.value.prizes.find(p => drawLimit(snapshot.value,p) > 0)?.type || snapshot.value.prizes[0]?.type }
  catch (err) { error.value = err.message }
  timer = setInterval(refresh, 2500)
})
onBeforeUnmount(() => { clearInterval(timer); engine.dispose(); state.ready = false; document.removeEventListener('fullscreenchange', fullscreenChanged); window.removeEventListener('keydown', keyboard) })
</script>
