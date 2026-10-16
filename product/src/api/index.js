async function request(url, method = 'GET', body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url, { method, cache: 'no-store', signal: controller.signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) { const error = new Error(data.error || `请求失败（${res.status}）`); error.status = res.status; throw error }
    return data
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接超时，请确认 Wi-Fi 连接后重试')
    if (error instanceof TypeError) throw new Error('暂时无法连接抽奖电脑，请检查 Wi-Fi 或服务是否运行')
    throw error
  } finally { clearTimeout(timer) }
}
export const api = {
  status: () => request('/api/admin/status'),
  network: () => request('/api/admin/network'),
  registration: open => request('/api/admin/registration', 'POST', { open }),
  config: (title, prizes) => request('/api/admin/config', 'POST', { title, prizes }),
  remove: id => request(`/api/admin/participants/${encodeURIComponent(id)}`, 'DELETE'),
  reset: scope => request('/api/admin/reset', 'POST', { scope }),
  draw: body => request('/api/admin/draw', 'POST', body),
  publicStatus: eventId => request(`/api/public/status?event=${encodeURIComponent(eventId)}`),
  register: body => request('/api/public/register', 'POST', body),
  getTempData: () => request('/getTempData', 'POST'),
  getUsers: () => request('/getUsers', 'POST')
}
