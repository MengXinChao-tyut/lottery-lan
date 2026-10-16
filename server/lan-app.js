const express = require('express');
const path = require('node:path');
const os = require('node:os');
const ExcelJS = require('exceljs');
const {EventStore,EventError,maskPhone}=require('./event-store');
function isLoopback(address) {
  return address==='::1' || address==='127.0.0.1' || address==='::ffff:127.0.0.1';
}
function networkInfo(port,eventId,interfaces=os.networkInterfaces()) {
  const joinPath=`/join?event=${encodeURIComponent(eventId)}`;const addresses=[];
  for(const [name,list] of Object.entries(interfaces))for(const item of list||[])if((item.family==='IPv4'||item.family===4)&&!item.internal)addresses.push({name,address:item.address,joinUrl:`http://${item.address}:${port}${joinPath}`});
  return{port,addresses,joinPath};
}
function adminBoundary(req,res,next) {
  if(!isLoopback(req.socket.remoteAddress))return res.status(403).json({error:'管理功能仅限本机访问'});
  const host=req.get('Host');
  // Host must name this listener, not an arbitrary domain resolving to loopback.
  const match=typeof host==='string'&&/^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/i.exec(host);
  const defaultPort=req.socket.encrypted?443:80;
  if(!match||Number(match[2]||defaultPort)!==req.socket.localPort)return res.status(403).json({error:'管理功能必须使用本机地址和实际服务端口'});
  if(!['GET','HEAD'].includes(req.method)) {
    const origin=req.get('Origin');
    if(origin) {
      let allowed=false;
      try {const url=new URL(origin);allowed=url.origin===`${req.socket.encrypted?'https':'http'}://${req.get('Host')}` && url.href===url.origin+'/';}catch{}
      if(!allowed)return res.status(403).json({error:'管理操作必须来自本机同源页面'});
    }
    // Browser cross-site form requests lack Origin on some older clients.
    if(req.get('Sec-Fetch-Site')==='cross-site')return res.status(403).json({error:'不允许跨站管理操作'});
  }
  next();
}
function compatibility(store) {
  const s=store.snapshot();const tuple=p=>[p.id,p.name,maskPhone(p.phone)];
  const won=new Set(s.rounds.flatMap(r=>r.winners.map(w=>w.id)));const luckyData={};
  for(const r of s.rounds){(luckyData[r.prizeType]??=[]).push(...r.winners.map(tuple));}
  return{cfgData:{prizes:s.prizes,EACH_COUNT:s.prizes.map(p=>p.perDraw),COMPANY:s.event.title},luckyData,leftUsers:s.participants.filter(p=>!won.has(p.id)).map(tuple),version:s.version};
}
const excelSafe=value=>typeof value==='string'&&/^[\s]*[=+\-@]/.test(value)?`'${value}`:value;
async function excelBuffer(snapshot,kind) {
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet(kind==='participants'?'报名名单':'中奖名单');
  sheet.addRow(kind==='participants'?['编号','姓名','手机号','报名时间']:['奖项','姓名','手机号','轮次','抽奖时间']);
  const rows=kind==='participants'?snapshot.participants.map(p=>[p.id,p.name,p.phone,p.joinedAt]):snapshot.rounds.flatMap(r=>r.winners.map(p=>[r.prizeName,p.name,p.phone,r.id,r.createdAt]));
  rows.forEach(row=>sheet.addRow(row.map(excelSafe)));sheet.getRow(1).font={bold:true};sheet.columns.forEach((column,i)=>column.width=[38,24,20,38,28][i]);sheet.views=[{state:'frozen',ySplit:1}];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
function createApp({dataFile,staticDir=path.join(__dirname,'..','product','dist'),store=new EventStore({dataFile})}={}) {
  const app=express();app.disable('x-powered-by');app.set('trust proxy',false);app.locals.store=store;
  app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');if(req.path.startsWith('/api/')||['/getUsers','/getTempData'].includes(req.path))res.set('Cache-Control','no-store');next();});
  app.use('/api/admin',adminBoundary);
  app.post(['/getTempData','/getUsers'],adminBoundary);
  app.use(express.json({limit:'32kb',strict:true}));
  const route=handler=>(req,res,next)=>Promise.resolve().then(()=>handler(req,res)).catch(next);
  app.get('/health',(req,res)=>res.json({ok:true}));
  app.get('/api/public/status',route((req,res)=>res.json(store.publicStatus(req.query.event))));
  app.post('/api/public/register',route(async(req,res)=>res.status(201).json(await store.register(req.body))));
  app.get('/api/admin/status',(req,res)=>res.json(store.snapshot()));
  app.post('/api/admin/registration',route(async(req,res)=>res.json(await store.setRegistration(req.body?.open))));
  app.post('/api/admin/config',route(async(req,res)=>res.json(await store.configure(req.body))));
  app.delete('/api/admin/participants/:id',route(async(req,res)=>res.json(await store.removeParticipant(req.params.id))));
  app.post('/api/admin/draw',route(async(req,res)=>res.json(await store.draw(req.body))));
  app.post('/api/admin/reset',route(async(req,res)=>res.json(await store.reset(req.body?.scope))));
  app.get('/api/admin/network',(req,res)=>res.json(networkInfo(req.socket.localPort,store.snapshot().event.id)));
  app.get('/api/admin/export',route(async(req,res)=>{
    const kind=req.query.kind;if(!['participants','winners'].includes(kind))throw new EventError('导出类型不正确');
    const buffer=await excelBuffer(store.snapshot(),kind);res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.set('Content-Disposition',`attachment; filename="lottery-${kind}.xlsx"`);res.send(buffer);
  }));
  app.post('/getTempData',(req,res)=>res.json(compatibility(store)));
  app.post('/getUsers',(req,res)=>res.json(store.snapshot().participants.map(p=>[p.id,p.name,maskPhone(p.phone)])));
  // Only compiled assets are public; neither source nor persistent data is mounted.
  app.get('/',(req,res,next)=>{if(!isLoopback(req.socket.remoteAddress))return res.redirect(`/join?event=${encodeURIComponent(store.snapshot().event.id)}`);next();});
  app.get('/display',adminBoundary);
  const absoluteStatic=path.resolve(staticDir);
  app.use(express.static(absoluteStatic,{index:false,dotfiles:'deny',redirect:false}));
  app.get(['/','/join','/display'],(req,res,next)=>res.sendFile(path.join(absoluteStatic,'index.html'),err=>err?next(err):undefined));
  app.use((req,res)=>res.status(404).json({error:'接口或页面不存在'}));
  app.use((err,req,res,next)=>{
    if(res.headersSent)return next(err);
    const status=err instanceof EventError?err.status:err.type==='entity.parse.failed'?400:err.type==='entity.too.large'?413:err.status===404?404:500;
    if(status===500)console.error('[lottery] 请求失败:',err.message);
    res.status(status).json({error:err instanceof EventError?err.message:status===400?'请求格式不正确':status===413?'请求内容过大':status===404?'页面尚未构建或不存在':'保存或处理失败，请重试'});
  });
  return app;
}
module.exports={createApp,isLoopback,networkInfo,excelBuffer};
