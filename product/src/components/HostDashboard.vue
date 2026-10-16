<template>
  <main class="lan-ui host-page">
    <header class="host-header"><div class="brand"><span class="brand-mark">✦</span> 现场抽奖 <span class="host-label">主持人控制台</span></div><span class="connection-label"><span :class="['dot', { closed: !!error }]"></span>{{ error ? '连接待恢复' : '本机管理' }}</span></header>
    <div v-if="error" class="notice error" role="alert">{{ error }}<button class="text-button" @click="refresh">重试</button></div>
    <div v-if="!snapshot" class="empty-state">{{ error ? '请在抽奖电脑上使用 localhost 地址打开管理页面。' : '正在加载活动…' }}</div>
    <template v-else>
      <section class="host-heading"><div><span class="eyebrow">准备好，把幸运交给现场。</span><h1>{{ snapshot.event.title }}</h1><p class="subtitle">{{ snapshot.event.registrationOpen ? '展示二维码，让来宾扫码加入抽奖。' : '名单已锁定，可以开始抽奖。' }}</p></div><div><button v-if="snapshot.event.registrationOpen" class="primary" :disabled="busy || !snapshot.participants.length || editing" @click="closeAndDraw">关闭报名并去抽奖 →</button><a v-else class="button primary" href="/display">进入抽奖大屏 →</a></div></section>
      <section class="stats-grid"><div class="stat-card"><span>已报名人数</span><strong>{{ snapshot.participants.length }}<small> 人</small></strong></div><div class="stat-card"><span>尚未中奖</span><strong>{{ snapshot.availableCount }}<small> 人</small></strong></div><div class="stat-card"><span>已产生中奖名额</span><strong>{{ winnerCount }}<small> 位</small></strong></div><div class="stat-card"><span>报名状态</span><strong class="status-value">{{ snapshot.event.registrationOpen ? '进行中' : '已截止' }}</strong><small>{{ snapshot.event.registrationOpen ? '名单自动更新' : '已锁定参与名单' }}</small></div></section>
      <div class="host-columns">
        <section class="panel qr-panel"><div class="panel-heading"><h2>扫码加入</h2><span class="pill">同一 Wi-Fi</span></div>
          <template v-if="addresses.length"><label for="lan-address">报名地址 · 选择 Wi-Fi 网卡</label><select id="lan-address" v-model="addressKey" :disabled="qrEnlarged"><option v-for="address in addresses" :key="address.address" :value="address.address">{{ address.name }} · {{ address.address }}</option></select>
            <button class="qr-button" @click="qrEnlarged = true" :disabled="!qr || busy"><img v-if="qr" :src="qr" alt="手机扫码报名二维码" /><span v-else>正在生成二维码…</span></button><p class="qr-caption">手机扫码，填写姓名与手机号<br />点击二维码可放大展示</p><code class="join-url">{{ joinUrl }}</code><button class="secondary wide" @click="copyUrl">{{ copied ? '已复制报名链接' : '复制报名链接' }}</button></template>
          <p v-else class="notice">未检测到局域网地址，请先连接 Wi-Fi，然后点击“刷新名单”。</p><p v-if="qrError" class="notice error">{{ qrError }}</p><p class="form-note">管理操作仅在抽奖电脑上开放；手机只用于报名。</p>
        </section>
        <section class="panel roster-panel"><div class="panel-heading"><h2>参与名单 <span class="count-badge">{{ snapshot.participants.length }}</span></h2><button class="text-button" :disabled="busy" @click="refresh">刷新名单</button></div><div class="roster-tools"><span class="muted">{{ error ? '连接中断，显示上次名单' : '每 2 秒自动更新' }}</span><a class="text-link" href="/api/admin/export?kind=participants">导出报名名单 ↗</a></div>
          <div v-if="!snapshot.participants.length" class="empty-state"><div class="empty-symbol">＋</div><h3>等待第一位来宾</h3><p>将左侧二维码展示给现场来宾。</p></div>
          <div v-else class="table-scroll"><table><thead><tr><th>编号</th><th>姓名</th><th>手机号</th><th>报名时间</th><th></th></tr></thead><tbody><tr v-for="p in snapshot.participants" :key="p.id"><td class="muted">{{ p.id.slice(0, 8) }}</td><td class="person-name">{{ p.name }}</td><td>{{ maskPhone(p.phone) }}</td><td class="muted">{{ time(p.joinedAt) }}</td><td><button v-if="snapshot.event.registrationOpen" class="text-button danger-text" :disabled="busy" @click="remove(p)">移除</button><span v-else class="muted">已锁定</span></td></tr></tbody></table></div>
          <div class="panel-footer"><span>{{ snapshot.event.registrationOpen ? '同一手机号只计一次报名' : '本轮仅从以上名单中抽取' }}</span><button v-if="!snapshot.event.registrationOpen && !snapshot.rounds.length" class="secondary small" :disabled="busy" @click="reopen">重新开放报名</button></div>
        </section>
      </div>
      <section class="panel config-panel"><div class="panel-heading"><div><h2>活动与奖项</h2><p class="muted">开奖后保留当前奖项配置；重置结果后可修改。</p></div><button v-if="!snapshot.rounds.length" class="secondary" :disabled="busy" @click="toggleEdit">{{ editing ? '取消编辑' : '编辑配置' }}</button></div>
        <form v-if="editing" @submit.prevent="saveConfig"><label for="event-title">活动名称</label><input id="event-title" v-model="draft.title" maxlength="40" required /><div class="table-scroll"><table class="config-table"><thead><tr><th>奖项名称</th><th>奖品说明</th><th>总名额</th><th>每轮人数</th><th></th></tr></thead><tbody><tr v-for="(p,i) in draft.prizes" :key="p.type"><td><input v-model="p.text" maxlength="30" required aria-label="奖项名称" /></td><td><input v-model="p.title" maxlength="60" aria-label="奖品说明" /></td><td><input v-model.number="p.count" type="number" min="1" max="100" required aria-label="奖项总名额" /></td><td><input v-model.number="p.perDraw" type="number" min="1" :max="p.count" required aria-label="每轮抽奖人数" /></td><td><button type="button" class="text-button danger-text" :disabled="draft.prizes.length === 1" @click="draft.prizes.splice(i,1)">删除</button></td></tr></tbody></table></div><div class="edit-actions"><button type="button" class="secondary" :disabled="draft.prizes.length >= 10" @click="addPrize">＋ 添加奖项</button><button class="primary" :disabled="busy">{{ busy ? '正在保存…' : '保存配置' }}</button></div></form>
        <div v-else class="prize-grid"><article v-for="p in snapshot.prizes" :key="p.type" class="prize-summary"><span class="prize-icon">✦</span><div><h3>{{ p.text }}</h3><p>{{ p.title || '幸运礼品' }}</p><span class="muted">共 {{ p.count }} 个名额 · 每轮 {{ p.perDraw }} 人</span></div></article></div>
      </section>
      <section v-if="snapshot.rounds.length" class="panel history-panel"><div class="panel-heading"><h2>中奖记录</h2><a class="text-link" href="/api/admin/export?kind=winners">导出中奖记录 ↗</a></div><div class="table-scroll"><table><thead><tr><th>奖项</th><th>中奖者</th><th>手机号</th><th>开奖时间</th></tr></thead><tbody><template v-for="round in [...snapshot.rounds].reverse()" :key="round.id"><tr v-for="p in round.winners" :key="`${round.id}-${p.id}`"><td>{{ round.prizeName }}</td><td class="person-name">{{ p.name }}</td><td>{{ maskPhone(p.phone) }}</td><td class="muted">{{ time(round.createdAt) }}</td></tr></template></tbody></table></div></section>
      <footer class="host-footer"><span>名单和结果保存在本机 · 刷新页面不会清空</span><div><button class="text-button" :disabled="busy || editing" @click="reset('results')">重置抽奖结果</button><button class="text-button danger-text" :disabled="busy || editing" @click="reset('all')">开始新活动</button></div></footer>
      <div v-if="message" class="toast" role="status">{{ message }}</div>
      <div v-if="confirmation" class="confirm-overlay"><section class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">确认操作</h2><p>{{ confirmation.message }}</p><div class="edit-actions"><button class="secondary" @click="answerConfirmation(false)">取消</button><button class="primary" @click="answerConfirmation(true)">确认继续</button></div></section></div>
      <div v-if="qrEnlarged" class="qr-overlay" @click.self="qrEnlarged = false"><section class="qr-large-card"><button class="overlay-close" aria-label="关闭二维码" @click="qrEnlarged = false">×</button><h2>{{ snapshot.event.title }}</h2><p>连接活动 Wi-Fi，扫码报名</p><img :src="qr" alt="放大的手机报名二维码" /><p class="qr-large-count">{{ snapshot.participants.length }} 人已报名</p><code>{{ joinUrl }}</code></section></div>
    </template>
  </main>
</template>
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import QRCode from 'qrcode'
import { api } from '../api/index.js'
import { maskPhone } from '../lan-utils.mjs'
const snapshot = ref(null), network = ref(null), busy = ref(false), error = ref(''), message = ref('')
const editing = ref(false), draft = ref({ title: '', prizes: [] }), addressKey = ref(''), qr = ref(''), qrError = ref(''), qrEnlarged = ref(false), copied = ref(false)
const confirmation = ref(null)
function confirmAction(message) { return new Promise(resolve => { confirmation.value = { message, resolve } }) }
function answerConfirmation(answer) { const resolve = confirmation.value?.resolve; confirmation.value = null; resolve?.(answer) }
const addresses = computed(() => network.value?.addresses || [])
const joinUrl = computed(() => {
  const address = addresses.value.find(a => a.address === addressKey.value) || addresses.value[0]
  return address && snapshot.value ? `http://${address.address}:${network.value.port}/join?event=${encodeURIComponent(snapshot.value.event.id)}` : ''
})
const winnerCount = computed(() => snapshot.value?.rounds.reduce((sum,r) => sum+r.winners.length, 0) || 0)
let pollTimer, messageTimer, copyTimer, fetching = false, qrSequence = 0, actionSequence = 0
const time = value => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
function notify(text) { message.value = text; clearTimeout(messageTimer); messageTimer = setTimeout(() => message.value = '', 4500) }
async function refresh() {
  if (fetching || busy.value) return
  fetching = true
  const sequence = actionSequence
  try {
    const [data, net] = await Promise.all([api.status(), api.network()]); if (sequence !== actionSequence) return; snapshot.value = data; network.value = net; error.value = ''
    if (!net.addresses.some(a => a.address === addressKey.value)) addressKey.value = (net.addresses.find(a => /wlan|wi.?fi|无线/i.test(a.name)) || net.addresses[0])?.address || ''
  } catch (err) { if (sequence === actionSequence) error.value = err.message }
  finally { fetching = false }
}
async function action(fn, success) {
  if (busy.value) return false
  busy.value = true
  actionSequence++
  try { snapshot.value = await fn(); error.value = ''; if (success) notify(success); return true }
  catch (err) { error.value = err.message; return false }
  finally { busy.value = false }
}
async function closeAndDraw() {
  if (!await confirmAction(`确认关闭报名？当前共有 ${snapshot.value.participants.length} 人，关闭后将锁定这份名单。`)) return
  if (await action(() => api.registration(false))) location.href = '/display'
}
function reopen() { action(() => api.registration(true), '已重新开放报名') }
async function remove(p) { if (await confirmAction(`移除 ${p.name}（${maskPhone(p.phone)}）的报名？`)) action(() => api.remove(p.id), '已移除报名') }
async function reset(scope) {
  const text = scope === 'all' ? '开始新活动将清空当前报名和中奖记录，并更换二维码。请先导出需要保留的数据。确认继续？' : '这会清空中奖结果、保留报名名单，并重新开放报名。确认继续？'
  if (await confirmAction(text)) action(() => api.reset(scope), scope === 'all' ? '新活动已开始，请展示新的二维码' : '中奖结果已重置')
}
function toggleEdit() { editing.value = !editing.value; if (editing.value) draft.value = { title: snapshot.value.event.title, prizes: snapshot.value.prizes.map(p => ({ ...p })) } }
function addPrize() { const type = Math.max(0, ...draft.value.prizes.map(p => p.type)) + 1; draft.value.prizes.push({ type, text: '幸运奖', title: '', count: 1, perDraw: 1, img: '/img/secrit.jpg' }) }
async function saveConfig() { if (await action(() => api.config(draft.value.title.trim(), draft.value.prizes), '活动配置已保存')) editing.value = false }
async function copyUrl() {
  try { await navigator.clipboard.writeText(joinUrl.value); copied.value = true; clearTimeout(copyTimer); copyTimer = setTimeout(() => copied.value = false, 2500) }
  catch { notify('复制失败，请选中报名地址手动复制') }
}
watch(joinUrl, async value => {
  const sequence = ++qrSequence; qr.value = ''; qrError.value = ''; if (!value) return
  try { const encoded = await QRCode.toDataURL(value, { width: 640, margin: 3, errorCorrectionLevel: 'M', color: { dark: '#153d35', light: '#ffffff' } }); if (sequence === qrSequence) qr.value = encoded }
  catch { if (sequence === qrSequence) qrError.value = '二维码生成失败，请使用下方报名链接。' }
})
onMounted(() => { refresh(); pollTimer = setInterval(refresh, 2000) })
onBeforeUnmount(() => { clearInterval(pollTimer); clearTimeout(messageTimer); clearTimeout(copyTimer) })
</script>
