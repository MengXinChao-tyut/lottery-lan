import test from 'node:test'
import assert from 'node:assert/strict'
import { drawLimit, makeIntent, normalizePhone, toUser } from '../src/lan-utils.mjs'
test('phone normalization and displayed tuple mask real contact data', () => {
  assert.equal(normalizePhone(' +86 138-0000-0001 '), '13800000001')
  assert.equal(normalizePhone('0086 13800000001'), '13800000001')
  assert.deepEqual(toUser({ id: 'guest', name: '<b>来宾</b>', phone: '13800000001' }), ['guest', '<b>来宾</b>', '138****0001'])
})
test('draw counts respect per-round cap, remaining prize stock and eligible roster', () => {
  const prize = { type: 2, count: 10, perDraw: 2 }
  const snapshot = { availableCount: 20, rounds: [] }
  assert.equal(drawLimit(snapshot, prize), 2)
  snapshot.availableCount = 1
  assert.equal(drawLimit(snapshot, prize), 1)
  snapshot.availableCount = 20
  snapshot.rounds = [{ prizeType: 2, winners: Array(9).fill({}) }, { prizeType: 3, winners: Array(2).fill({}) }]
  assert.equal(drawLimit(snapshot, prize), 1)
  snapshot.rounds[0].winners.push({})
  assert.equal(drawLimit(snapshot, prize), 0)
  assert.equal(drawLimit(null, prize), 0)
})
test('each intention freezes the event and reset generation with a unique retry identity', () => {
  const event = { id: 'event1', drawGeneration: 'generation1' }
  const a = makeIntent(event, 2, 1), b = makeIntent(event, 2, 1)
  event.id = 'event2'; event.drawGeneration = 'generation2'
  assert.equal(a.eventId, 'event1')
  assert.equal(a.drawGeneration, 'generation1')
  assert.equal(a.prizeType, 2)
  assert.equal(a.count, 1)
  assert.notEqual(a.requestId, b.requestId)
  assert.match(a.requestId, /^[\w-]+$/)
})
