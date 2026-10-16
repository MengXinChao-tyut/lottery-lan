<template>
  <main class="lan-ui join-page">
    <div class="brand"><span class="brand-mark">✦</span> 现场抽奖</div>
    <section class="join-card">
      <span class="eyebrow">活动报名</span><h1>{{ event?.title || '加入现场抽奖' }}</h1><p class="subtitle">留下你的名字，让幸运找到你。</p>
      <div v-if="loading" class="notice" role="status">正在连接活动…</div>
      <div v-if="fatal" class="notice error" role="alert">{{ fatal }}</div>
      <template v-if="event">
        <div class="status-strip"><span :class="['dot', { closed: !event.registrationOpen }]"></span>{{ event.registrationOpen ? '报名进行中' : '报名已截止' }}<span>{{ total }} 人已报名</span></div>
        <div v-if="own" class="success-panel" role="status"><div class="success-icon">✓</div><h2>报名成功</h2><p>{{ own.name }}，你已进入本次抽奖名单。</p><div class="ticket"><span>你的参与编号</span><strong>{{ own.id.slice(0, 8) }}</strong><small>{{ own.phoneMasked }}</small></div><p class="muted">请留在现场，等待主持人开奖。</p><p class="form-note">需要更正信息，请先联系主持人移除原报名。</p><button class="secondary wide" @click="fillAgain">重新填写报名</button></div>
        <div v-else-if="!event.registrationOpen" class="empty-state"><h2>本次报名已截止</h2><p>请联系现场主持人。</p></div>
        <form v-else @submit.prevent="submit">
          <label for="guest-name">姓名</label><input id="guest-name" v-model="name" autocomplete="name" maxlength="30" placeholder="请输入真实姓名" required :disabled="submitting" />
          <label for="guest-phone">手机号</label><input id="guest-phone" v-model="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="请输入 11 位手机号" required :disabled="submitting" />
          <p class="form-note">用于本次抽奖和现场兑奖，同一手机号只能报名一次。</p><div v-if="formError" class="notice error" role="alert">{{ formError }}</div>
          <button class="primary wide" :disabled="submitting">{{ submitting ? '正在提交…' : '确认报名' }} <span>→</span></button>
        </form>
      </template>
      <p v-if="connectionError" class="notice error" role="alert">{{ connectionError }}<button class="text-button" @click="load">重新连接</button></p>
    </section><p class="join-footer">请保持连接活动 Wi-Fi</p>
  </main>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api/index.js'
import { normalizePhone } from '../lan-utils.mjs'
const eventId = new URLSearchParams(location.search).get('event') || ''
const storageKey = `lottery-registration:${eventId}`
const event = ref(null), total = ref(0), own = ref(null), loading = ref(true), fatal = ref(''), connectionError = ref(''), formError = ref('')
const name = ref(''), phone = ref(''), submitting = ref(false)
let timer, fetching = false
async function load() {
  if (fetching) return
  if (!eventId) { fatal.value = '请扫描主持人当前展示的报名二维码。'; loading.value = false; return }
  fetching = true
  try { const data = await api.publicStatus(eventId); event.value = data.event; total.value = data.count; connectionError.value = ''; fatal.value = '' }
  catch (error) {
    if ([404, 409, 410].includes(error.status)) { fatal.value = '这个活动链接已失效，请重新扫描现场二维码。'; event.value = null; own.value = null }
    else connectionError.value = error.message
  } finally { loading.value = false; fetching = false }
}
async function submit() {
  if (submitting.value) return
  formError.value = ''
  const normalized = normalizePhone(phone.value)
  if (!name.value.trim()) { formError.value = '请填写姓名'; return }
  if (!/^1[3-9]\d{9}$/.test(normalized)) { formError.value = '请输入有效的 11 位手机号'; return }
  submitting.value = true
  try {
    const data = await api.register({ eventId, name: name.value.trim(), phone: normalized })
    own.value = data.participant
    try { localStorage.setItem(storageKey, JSON.stringify(data.participant)) } catch { /* local saving is optional */ }
    phone.value = ''; await load()
  } catch (error) { formError.value = error.message; await load() }
  finally { submitting.value = false }
}
function fillAgain() { own.value = null; name.value = ''; phone.value = ''; formError.value = ''; try { localStorage.removeItem(storageKey) } catch {} }
onMounted(() => {
  try { const saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (saved?.id && saved?.name && saved?.phoneMasked) own.value = saved } catch { /* ignore invalid local receipt */ }
  load(); timer = setInterval(load, 3000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>
