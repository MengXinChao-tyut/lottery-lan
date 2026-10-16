const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const http = require('node:http');
const {createApp,isLoopback,networkInfo}=require('../lan-app');
const {listenWithRetry}=require('../server');
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lottery-http-'));const staticDir=path.join(dir,'dist');fs.mkdirSync(staticDir);fs.writeFileSync(path.join(staticDir,'index.html'),'<html>SPA</html>');
 const app=createApp({dataFile:path.join(dir,'private','event.json'),staticDir});const server=await new Promise(resolve=>{const s=app.listen(0,'0.0.0.0',()=>resolve(s));});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`;
 async function request(route,body,method='POST',headers={}){const response=await fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});const content=await response.text();let data;try{data=JSON.parse(content);}catch{data=content;}return{response,data};}
 return {app,server,base,request,dir};
}
const register=(request,eventId,i=0,name='李四')=>request('/api/public/register',{eventId,name,phone:`1390000${String(i).padStart(4,'0')}`});
test('public registration is private, concurrent unique, validated, closed and stale-safe',async t=>{
 const {request}=await setup(t);const {data:s}=await request('/api/admin/status',null,'GET');assert.equal(s.participants.length,0);assert.equal(s.prizes.length,3);
 const pub=(await request(`/api/public/status?event=${s.event.id}`,null,'GET')).data;assert.deepEqual(Object.keys(pub).sort(),['count','event']);assert.deepEqual(Object.keys(pub.event).sort(),['id','registrationOpen','title']);
 const responses=await Promise.all([register(request,s.event.id),register(request,s.event.id)]);assert.deepEqual(responses.map(r=>r.response.status).sort(),[201,409]);const p=responses.find(r=>r.response.status===201).data.participant;assert.equal(p.phoneMasked,'139****0000');assert.equal(p.phone,undefined);
 assert.equal((await register(request,'stale',1)).response.status,409);assert.equal((await request('/api/public/register',{eventId:s.event.id,name:'x\u0000',phone:'13900000001'})).response.status,400);
 await request('/api/admin/registration',{open:false});assert.equal((await register(request,s.event.id,2)).response.status,409);assert.equal((await request('/api/public/status?event=stale',null,'GET')).response.status,409);
});
test('draw commits before response, concurrent retries are idempotent, legacy bypass fails',async t=>{
 const {request}=await setup(t);const s=(await request('/api/admin/status',null,'GET')).data;for(let i=0;i<3;i++)await register(request,s.event.id,i);await request('/api/admin/registration',{open:false});
 const draws=await Promise.all(Array.from({length:5},()=>request('/api/admin/draw',{eventId:s.event.id,drawGeneration:s.event.drawGeneration,prizeType:2,count:1,requestId:'http-round'})));assert.ok(draws.every(d=>d.response.status===200));assert.equal(new Set(draws.map(d=>d.data.round.id)).size,1);
 const snapshot=(await request('/api/admin/status',null,'GET')).data;assert.equal(snapshot.rounds.length,1);assert.equal(snapshot.availableCount,2);assert.equal((await request('/api/admin/draw',{eventId:s.event.id,drawGeneration:s.event.drawGeneration,prizeType:3,count:1,requestId:'http-round'})).response.status,409);assert.equal((await request('/api/admin/draw',{eventId:s.event.id,drawGeneration:s.event.drawGeneration,prizeType:3,count:2,requestId:'too-many'})).response.status,400);
 for(const route of ['/saveData','/errorData','/reset','/export','/unknown'])assert.equal((await request(route,{data:[['chosen']]})).response.status,404);
 const compat=(await request('/getTempData',{})).data;assert.equal(compat.leftUsers.length,2);assert.equal(compat.luckyData['2'].length,1);assert.ok(compat.leftUsers.every(row=>row[2].includes('****')));
});
test('actual loopback and exact Origin host/port secure mutations and compatibility',async t=>{
 const {request,server,base}=await setup(t);for(const address of ['127.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(isLoopback(address),true);assert.equal(isLoopback('192.168.1.2'),false);
 assert.equal((await request('/api/admin/reset',{scope:'results'},'POST',{Origin:'http://evil.example'})).response.status,403);assert.equal((await request('/api/admin/reset',{scope:'results'},'POST',{Origin:base})).response.status,200);assert.equal((await request('/api/admin/reset',{scope:'results'},'POST',{Origin:'null'})).response.status,403);const mismatch = await new Promise((resolve,reject)=>{const r=http.request(base+'/api/admin/reset',{method:'POST',headers:{Origin:base,Host:'localhost:'+server.address().port,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);r.end(JSON.stringify({scope:'results'}));});assert.equal(mismatch,403);
 const address=Object.values(os.networkInterfaces()).flat().find(a=>a.family==='IPv4'&&!a.internal);if(address){const url=`http://${address.address}:${server.address().port}`;assert.equal((await fetch(url+'/api/admin/status',{headers:{'X-Forwarded-For':'127.0.0.1','X-Forwarded-Host':'localhost'}})).status,403);assert.equal((await fetch(url+'/getUsers',{method:'POST'})).status,403);const root=await fetch(url+'/',{redirect:'manual'});assert.equal(root.status,302);assert.match(root.headers.get('location'),/^\/join\?event=/);}
});
test('Excel escapes formulas, exports buffers; static protection and actual network port',async t=>{
 const {request,server,base}=await setup(t);const s=(await request('/api/admin/status',null,'GET')).data;await register(request,s.event.id,0,'=SUM(1,2)');let response=await fetch(base+'/api/admin/export?kind=participants');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/spreadsheetml/);assert.match(response.headers.get('content-disposition'),/attachment/);const wb=new ExcelJS.Workbook();await wb.xlsx.load(await response.arrayBuffer());assert.equal(wb.worksheets[0].getCell('B2').value,"'=SUM(1,2)");
 await request('/api/admin/registration',{open:false});await request('/api/admin/draw',{eventId:s.event.id,drawGeneration:s.event.drawGeneration,prizeType:1,count:1,requestId:'export'});response=await fetch(base+'/api/admin/export?kind=winners');await wb.xlsx.load(await response.arrayBuffer());assert.equal(wb.worksheets[0].rowCount,2);
 const info=(await request('/api/admin/network',null,'GET')).data;assert.equal(info.port,server.address().port);assert.ok(info.addresses.every(a=>a.joinUrl.includes(`:${info.port}/join?event=`)));
 for(const route of ['/server/data/lan-event.json','/data/lan-event.json','/server/server.js','/package.json','/../private/event.json'])assert.equal((await fetch(base+route)).status,404);for(const route of ['/','/join','/display'])assert.match(await(await fetch(base+route)).text(),/SPA/);assert.equal((await request('/health',null,'GET')).data.ok,true);
});
test('IPv4 filtering and occupied-port retry report actual port',async t=>{
 assert.deepEqual(networkInfo(4321,'event id',{wifi:[{address:'192.168.1.3',family:'IPv4',internal:false},{address:'::1',family:'IPv6',internal:true}],lo:[{address:'127.0.0.1',family:'IPv4',internal:true}]}).addresses,[{name:'wifi',address:'192.168.1.3',joinUrl:'http://192.168.1.3:4321/join?event=event%20id'}]);const {app,server}=await setup(t);const extra=await listenWithRetry(app,server.address().port,false,3);t.after(()=>new Promise(resolve=>extra.close(resolve)));assert.equal(extra.address().port,server.address().port+1);assert.equal((await(await fetch(`http://127.0.0.1:${extra.address().port}/api/admin/network`)).json()).port,extra.address().port);
});

test('admin configuration, deletion and reset return exact snapshots; malformed input is JSON error',async t=>{
 const {request,base}=await setup(t);const before=(await request('/api/admin/status',null,'GET')).data;
 const configured=await request('/api/admin/config',{title:'现场测试',prizes:[{type:5,text:'幸运奖',title:'礼品',count:2,perDraw:1,img:''}]});assert.equal(configured.response.status,200);assert.deepEqual(Object.keys(configured.data).sort(),['availableCount','event','participants','prizes','rounds','version']);
 const participant=(await register(request,before.event.id)).data.participant;const deleted=await request('/api/admin/participants/'+participant.id,null,'DELETE');assert.equal(deleted.data.participants.length,0);
 const all=await request('/api/admin/reset',{scope:'all'});assert.notEqual(all.data.event.id,before.event.id);assert.equal(all.data.event.title,'现场测试');assert.equal(all.data.prizes[0].type,5);
 const malformed=await fetch(base+'/api/public/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad json'});assert.equal(malformed.status,400);assert.equal(typeof(await malformed.json()).error,'string');
 assert.equal((await request('/api/admin/registration',{open:'false'})).response.status,400);
 assert.equal((await request('/api/admin/export?kind=unknown',null,'GET')).response.status,400);
});
function rawRequest(base,route,method,headers,body){
  return new Promise((resolve,reject)=>{
    const req=http.request(base+route,{method,headers},res=>{let content='';res.setEncoding('utf8');res.on('data',chunk=>content+=chunk);res.on('end',()=>resolve({status:res.statusCode,content}));});
    req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
}
test('DNS-rebinding hostnames and wrong ports fail on admin reads, mutations and display',async t=>{
  const {base,server}=await setup(t);const port=server.address().port;
  for(const host of [`rebind.example:${port}`,`localhost:${port+1}`,`127.0.0.1:${port+1}`,`localhost.evil:${port}`]){
    for(const route of ['/api/admin/status','/api/admin/network','/api/admin/export?kind=participants','/display']){
      assert.equal((await rawRequest(base,route,'GET',{Host:host})).status,403,host+' '+route);
    }
    assert.equal((await rawRequest(base,'/api/admin/reset','POST',{Host:host,Origin:'http://'+host,'Content-Type':'application/json'},{scope:'results'})).status,403);
    assert.equal((await rawRequest(base,'/getUsers','POST',{Host:host})).status,403);
  }
  for(const host of [`localhost:${port}`,`127.0.0.1:${port}`,`[::1]:${port}`]){
    assert.equal((await rawRequest(base,'/api/admin/status','GET',{Host:host})).status,200);
    assert.equal((await rawRequest(base,'/api/admin/reset','POST',{Host:host,Origin:'http://'+host,'Content-Type':'application/json'},{scope:'results'})).status,200);
  }
});

test('HTTP delayed draw intent cannot be recreated after reset and reclosure',async t=>{
  const {request}=await setup(t);const initial=(await request('/api/admin/status',null,'GET')).data;await register(request,initial.event.id);await request('/api/admin/registration',{open:false});
  const intent={eventId:initial.event.id,drawGeneration:initial.event.drawGeneration,prizeType:1,count:1,requestId:'pending-before-reset'};
  const original=await request('/api/admin/draw',intent);assert.equal(original.response.status,200);
  const retry=await request('/api/admin/draw',intent);assert.equal(retry.data.round.id,original.data.round.id);
  const reset=(await request('/api/admin/reset',{scope:'results'})).data;assert.equal(reset.event.id,initial.event.id);assert.notEqual(reset.event.drawGeneration,initial.event.drawGeneration);await request('/api/admin/registration',{open:false});
  assert.equal((await request('/api/admin/draw',intent)).response.status,409);assert.equal((await request('/api/admin/status',null,'GET')).data.rounds.length,0);
  const full=(await request('/api/admin/reset',{scope:'all'})).data;await register(request,full.event.id,1);await request('/api/admin/registration',{open:false});
  assert.equal((await request('/api/admin/draw',{...intent,drawGeneration:full.event.drawGeneration})).response.status,409);assert.equal((await request('/api/admin/status',null,'GET')).data.rounds.length,0);
});
