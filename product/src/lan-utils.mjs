export const maskPhone = phone => String(phone).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
export const normalizePhone = phone => String(phone).trim().replace(/[\s-]/g, '').replace(/^(\+86|0086)/, '')
export const toUser = participant => [participant.id, participant.name, maskPhone(participant.phone)]
export function drawLimit(snapshot, prize) {
  if (!snapshot || !prize) return 0
  const used = snapshot.rounds.filter(r => r.prizeType === prize.type).reduce((sum, r) => sum + r.winners.length, 0)
  return Math.max(0, Math.min(snapshot.availableCount, prize.count - used, prize.perDraw, 100))
}
export const makeIntent = (event, prizeType, count) => ({ eventId: event.id, drawGeneration: event.drawGeneration, prizeType, count, requestId: crypto.randomUUID() })
