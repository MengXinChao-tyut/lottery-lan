const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {fork}=require('node:child_process');
const {runLauncher}=require('../launcher.cjs');
const root=path.resolve(__dirname,'..');
async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lottery-launcher-'));
  const dataDir=path.join(dir,'data');fs.mkdirSync(dataDir);const dist=path.join(dir,'dist');fs.mkdirSync(dist);fs.writeFileSync(path.join(dist,'index.html'),'test page');
  const worker=path.join(dir,'worker.cjs');
  fs.writeFileSync(worker,`const {runLauncher}=require(${JSON.stringify(path.join(root,'launcher.cjs'))});const {createApp,listenWithRetry}=require(${JSON.stringify(path.join(root,'server/server.js'))});let instance;process.on('message',async m=>{if(m==='stop'){await instance?.stop?.();process.disconnect();}});runLauncher({dataDir:process.argv[2],startPort:Number(process.argv[3]),openBrowser:url=>process.send({opened:url}),startServer:()=>listenWithRetry(createApp({dataFile:require('node:path').join(process.argv[2],'event.json'),staticDir:${JSON.stringify(dist)}}),Number(process.argv[3]),false)}).then(result=>{instance=result;process.send({ready:true,duplicate:result.duplicate,port:result.port});if(result.duplicate)process.disconnect();}).catch(error=>{process.send({error:error.message});process.disconnect();process.exitCode=1;});`);
  const children=[];
  function launch(port=0){
    const child=fork(worker,[dataDir,String(port)],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});children.push(child);let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);let opened;
    const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('launcher timeout: '+output)),15000);child.on('message',m=>{if(m.opened)opened=m.opened;if(m.ready){clearTimeout(timer);resolve({...m,opened});}if(m.error){clearTimeout(timer);reject(new Error(m.error));}});child.on('exit',code=>{clearTimeout(timer);if(code)reject(new Error('launcher exit '+code+': '+output));});});
    return{child,ready,exit:new Promise(resolve=>child.once('exit',resolve))};
  }
  t.after(async()=>{for(const child of children)if(child.exitCode===null&&!child.killed)child.kill();await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve))));fs.rmSync(dir,{recursive:true,force:true});});
  return{dir,dataDir,launch};
}
test('duplicate double-click reuses one process and stop allows a new owner',async t=>{
  const {dataDir,launch}=await fixture(t);const first=launch();const one=await first.ready;assert.equal(one.duplicate,false);assert.equal(one.opened,`http://127.0.0.1:${one.port}`);
  const duplicate=launch();const two=await duplicate.ready;assert.equal(two.duplicate,true);assert.equal(two.port,one.port);assert.equal(two.opened,one.opened);await duplicate.exit;
  const lock=JSON.parse(fs.readFileSync(path.join(dataDir,'lan-process.lock')));assert.equal(lock.pid,first.child.pid);assert.equal(lock.port,one.port);
  first.child.send('stop');await first.exit;assert.equal(fs.existsSync(path.join(dataDir,'lan-process.lock')),false);
  const next=launch();const three=await next.ready;assert.equal(three.duplicate,false);assert.notEqual(JSON.parse(fs.readFileSync(path.join(dataDir,'lan-process.lock'))).pid,first.child.pid);
});
test('simultaneous startups yield exactly one writer',async t=>{
  const {launch,dataDir}=await fixture(t);const a=launch(),b=launch();const [one,two]=await Promise.all([a.ready,b.ready]);assert.equal([one,two].filter(r=>r.duplicate===false).length,1);assert.equal(one.port,two.port);assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'event.json'))).participants.length,0);
});
test('dead PID lock is reclaimed, occupied port reports actual fallback',async t=>{
  const {launch,dataDir}=await fixture(t);const prior=launch();await prior.ready;prior.child.send('stop');await prior.exit;
  fs.writeFileSync(path.join(dataDir,'lan-process.lock'),JSON.stringify({pid:prior.child.pid,port:12345,token:'old'}));
  const blocker=net.createServer();await new Promise(resolve=>blocker.listen(0,'0.0.0.0',resolve));t.after(()=>new Promise(resolve=>blocker.close(resolve)));const occupied=blocker.address().port;
  const active=await launch(occupied).ready;assert.equal(active.duplicate,false);assert.ok(active.port>occupied);assert.equal(active.opened,`http://127.0.0.1:${active.port}`);assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'lan-process.lock'))).port,active.port);
});
test('malformed existing lock fails closed without starting a writer',async t=>{
  const {dataDir}=await fixture(t);fs.writeFileSync(path.join(dataDir,'lan-process.lock'),'not json');let starts=0;
  await assert.rejects(runLauncher({dataDir,waitMs:10,startServer:async()=>{starts++;},openBrowser:()=>{}}),/锁文件/);assert.equal(starts,0);assert.equal(fs.readFileSync(path.join(dataDir,'lan-process.lock'),'utf8'),'not json');
});
test('shutdown does not remove a lock now owned by another token',async t=>{
  const {dataDir,launch}=await fixture(t);const first=launch();const active=await first.ready;
  const changed={pid:process.pid,port:active.port,token:'different-owner'};fs.writeFileSync(path.join(dataDir,'lan-process.lock'),JSON.stringify(changed));
  first.child.send('stop');await first.exit;assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir,'lan-process.lock'))),changed);
});
test('unfinished live-owner startup and damaged recovery guard fail closed',async t=>{
  const {dataDir}=await fixture(t);const lock=path.join(dataDir,'lan-process.lock');let starts=0;
  fs.writeFileSync(lock,JSON.stringify({pid:process.pid,port:null,token:'starting'}));
  await assert.rejects(runLauncher({dataDir,waitMs:10,startServer:async()=>{starts++;},openBrowser:()=>{}}),/已经启动/);
  fs.writeFileSync(lock+'.reclaim','incomplete guard');
  await assert.rejects(runLauncher({dataDir,waitMs:10,startServer:async()=>{starts++;},openBrowser:()=>{}}),/锁文件/);
  assert.equal(starts,0);assert.equal(JSON.parse(fs.readFileSync(lock)).token,'starting');
});
