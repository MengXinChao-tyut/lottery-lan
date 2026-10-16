const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventStore, normalizePhone } = require('../event-store');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lottery-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'event.json');
  return { store: new EventStore({ dataFile }), dataFile };
}
function identity(store) { const event=store.snapshot().event; return {eventId:event.id,drawGeneration:event.drawGeneration}; }
async function add(store, number = 0, name = '张三') {
  return store.register({ eventId: store.snapshot().event.id, name, phone: `1380000${String(number).padStart(4, '0')}` });
}
test('empty defaults and mainland phone normalization', t => {
  const { store } = fixture(t);
  assert.equal(store.snapshot().participants.length, 0);
  assert.equal(store.snapshot().event.title, '现场幸运抽奖');
  assert.deepEqual(store.snapshot().prizes.map(p => [p.type, p.text, p.count, p.perDraw]), [[1,'一等奖',1,1],[2,'二等奖',2,1],[3,'三等奖',3,1]]);
  assert.equal(normalizePhone(' +86 138-0000-0000 '), '13800000000');
  assert.equal(normalizePhone('0086 13900000000'), '13900000000');
  assert.throws(() => normalizePhone('12800000000'));
});
test('serialized registration, input validation, uniqueness and restart durability', async t => {
  const { store, dataFile } = fixture(t);
  const requests = await Promise.allSettled([add(store), add(store)]);
  assert.equal(requests.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(store.snapshot().participants.length, 1);
  const eventId = store.snapshot().event.id;
  for (const body of [{eventId,name:'',phone:'13900000000'},{eventId,name:'bad\nname',phone:'13900000000'},{eventId,name:'x'.repeat(31),phone:'13900000000'},{eventId:'stale',name:'甲',phone:'13900000000'}]) await assert.rejects(store.register(body));
  assert.deepEqual(new EventStore({dataFile}).snapshot(), store.snapshot());
  assert.deepEqual(fs.readdirSync(path.dirname(dataFile)), ['event.json']);
  const copy = store.snapshot(); copy.participants[0].name = 'changed';
  assert.equal(store.snapshot().participants[0].name, '张三');
});
test('closure locks roster; random draw immediate, unique, bounded and idempotent', async t => {
  const { store, dataFile } = fixture(t);
  for (let i=0; i<6; i++) await add(store,i);
  await assert.rejects(store.draw({...identity(store),prizeType:1,count:1,requestId:'round-a'}));
  await store.setRegistration(false);
  const closed = store.snapshot();
  await assert.rejects(add(store,6));
  await assert.rejects(store.removeParticipant(closed.participants[0].id));
  const [one,two] = await Promise.all([store.draw({...identity(store),prizeType:1,count:1,requestId:'round-a'}),store.draw({...identity(store),prizeType:1,count:1,requestId:'round-a'})]);
  assert.deepEqual(one.round,two.round);
  assert.equal(store.snapshot().rounds.length,1);
  await assert.rejects(store.draw({...identity(store),prizeType:2,count:1,requestId:'round-a'}));
  await assert.rejects(store.draw({...identity(store),prizeType:2,count:0,requestId:'bad-zero'}));
  await assert.rejects(store.draw({...identity(store),prizeType:1,count:1,requestId:'over-inventory'}));
  await assert.rejects(store.draw({...identity(store),prizeType:2,count:1,requestId:''}));
  await store.draw({...identity(store),prizeType:2,count:1,requestId:'round-b'});
  assert.equal(new EventStore({dataFile}).snapshot().availableCount,4);
  assert.equal(new Set(store.snapshot().rounds.flatMap(r=>r.winners.map(w=>w.id))).size,2);
  await assert.rejects(store.setRegistration(true));
  const originalId=store.snapshot().event.id;
  await store.reset('results');
  assert.equal(store.snapshot().participants.length,6);
  assert.equal(store.snapshot().event.registrationOpen,true);
  await store.reset('all');
  assert.notEqual(store.snapshot().event.id,originalId);
  assert.equal(store.snapshot().participants.length,0);
});
test('locked participant IDs survive restart and exhausted roster cannot draw', async t => {
  const {store,dataFile}=fixture(t); await add(store); await store.setRegistration(false);
  assert.deepEqual(JSON.parse(fs.readFileSync(dataFile)).lockedParticipantIds,store.snapshot().participants.map(p=>p.id));
  const reopened=new EventStore({dataFile}); await reopened.draw({...identity(reopened),prizeType:2,count:1,requestId:'only'});
  await assert.rejects(reopened.draw({...identity(reopened),prizeType:3,count:1,requestId:'empty'}));
});
test('failed atomic commit preserves previous memory and disk', async t => {
  const {store,dataFile}=fixture(t); await add(store);
  const before=store.snapshot(); const bytes=fs.readFileSync(dataFile,'utf8');
  const rename=fs.renameSync; fs.renameSync=()=>{throw new Error('simulated disk failure');};
  try { await assert.rejects(add(store,1)); } finally { fs.renameSync=rename; }
  assert.deepEqual(store.snapshot(),before); assert.equal(fs.readFileSync(dataFile,'utf8'),bytes);
  assert.deepEqual(fs.readdirSync(path.dirname(dataFile)),['event.json']);
  await add(store,2); assert.equal(store.snapshot().participants.length,2);
});
test('corrupt persisted data fails closed', t => {
  const {dataFile}=fixture(t); fs.writeFileSync(dataFile,'bad json');
  assert.throws(()=>new EventStore({dataFile}));
});
test('config validation, deletion and resets respect result/roster semantics',async t=>{
 const {store}=fixture(t);await add(store);let s=store.snapshot();await assert.rejects(store.configure({title:'现场',prizes:[{type:1,text:'奖',title:'',count:1,perDraw:2,img:''}]}));
 await store.configure({title:'测试活动',prizes:[{type:9,text:'纪念奖',title:'礼品',count:3,perDraw:2,img:'img/gift.jpg'}]});await store.removeParticipant(s.participants[0].id);assert.equal(store.snapshot().participants.length,0);
 for(let i=0;i<3;i++)await add(store,i);await store.setRegistration(false);const result=await store.draw({...identity(store),prizeType:9,count:2,requestId:'multi'});assert.equal(result.round.winners.length,2);assert.equal(new Set(result.round.winners.map(p=>p.id)).size,2);
 await assert.rejects(store.configure({title:'x',prizes:[]}));await store.reset('all');s=store.snapshot();assert.equal(s.event.title,'测试活动');assert.equal(s.prizes[0].type,9);assert.equal(s.rounds.length,0);
});
test('empty event ID is persisted immediately and independent reads survive cwd',t=>{
 const {store,dataFile}=fixture(t);assert.deepEqual(new EventStore({dataFile}).snapshot(),store.snapshot());assert.equal(JSON.parse(fs.readFileSync(dataFile)).participants.length,0);
});
test('different concurrent draws cannot exceed inventory or award anyone twice',async t=>{
 const {store}=fixture(t);for(let i=0;i<4;i++)await add(store,i);await store.setRegistration(false);
 const inventory=await Promise.allSettled([store.draw({...identity(store),prizeType:1,count:1,requestId:'race-a'}),store.draw({...identity(store),prizeType:1,count:1,requestId:'race-b'})]);assert.equal(inventory.filter(r=>r.status==='fulfilled').length,1);
 await Promise.all([store.draw({...identity(store),prizeType:2,count:1,requestId:'race-c'}),store.draw({...identity(store),prizeType:2,count:1,requestId:'race-d'})]);const winners=store.snapshot().rounds.flatMap(r=>r.winners);assert.equal(winners.length,3);assert.equal(new Set(winners.map(p=>p.id)).size,3);
});
test('draw identity invalidates old requests after results reset and full event reset', async t => {
  const {store,dataFile}=fixture(t);await add(store);await store.setRegistration(false);
  const event=store.snapshot().event;
  const old={eventId:event.id,drawGeneration:event.drawGeneration,prizeType:1,count:1,requestId:'delayed'};
  await store.draw(old);
  await store.reset('results');await store.setRegistration(false);
  const reset=store.snapshot();
  assert.notEqual(reset.event.drawGeneration,event.drawGeneration);
  await assert.rejects(store.draw(old),err=>err.status===409);
  assert.equal(store.snapshot().rounds.length,0);
  const current={...old,drawGeneration:reset.event.drawGeneration};
  const one=await store.draw(current);const retry=await store.draw(current);assert.deepEqual(one.round,retry.round);
  await store.reset('all');await add(store,1);await store.setRegistration(false);
  await assert.rejects(store.draw(current),err=>err.status===409);
  assert.equal(store.snapshot().rounds.length,0);
  assert.equal(new EventStore({dataFile}).snapshot().event.drawGeneration,store.snapshot().event.drawGeneration);
});
test('missing draw identity is rejected and schema1 generation migration persists',async t=>{
  const {store,dataFile}=fixture(t);await add(store);await store.setRegistration(false);
  await assert.rejects(store.draw({prizeType:1,count:1,requestId:'missing-identity'}),err=>err.status===400);
  const legacy=JSON.parse(fs.readFileSync(dataFile));delete legacy.event.drawGeneration;fs.writeFileSync(dataFile,JSON.stringify(legacy));
  const migrated=new EventStore({dataFile});assert.equal(typeof migrated.snapshot().event.drawGeneration,'string');assert.ok(migrated.snapshot().event.drawGeneration.length>0);
  assert.deepEqual(new EventStore({dataFile}).snapshot(),migrated.snapshot());assert.deepEqual(migrated.snapshot().participants,store.snapshot().participants);
});
