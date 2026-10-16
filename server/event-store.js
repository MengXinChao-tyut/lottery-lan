const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomInt } = require('node:crypto');
class EventError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new EventError(message, status); };
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const DEFAULT_PRIZES = [1,2,3].map((type, i) => ({type, text:['一等奖','二等奖','三等奖'][i], title:'', count:type, perDraw:1, img:''}));
function freshEvent(title = '现场幸运抽奖', prizes = DEFAULT_PRIZES) {
  return {schemaVersion:1,event:{id:randomUUID(),drawGeneration:randomUUID(),title,registrationOpen:true,createdAt:now()},participants:[],prizes:clone(prizes),rounds:[],lockedParticipantIds:[],version:0};
}
function normalizePhone(value) {
  if (typeof value !== 'string') fail('请输入有效的手机号');
  const phone = value.replace(/[\s-]/g,'').replace(/^(?:\+86|0086)/,'');
  if (!/^1[3-9]\d{9}$/.test(phone)) fail('请输入有效的中国大陆手机号');
  return phone;
}
function printable(value, label, max, allowEmpty = false) {
  if (typeof value !== 'string') fail(`${label}格式不正确`);
  // Check controls before trimming so trailing newlines cannot disappear silently.
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)) fail(`${label}不能含控制字符`);
  const trimmed=value.trim();
  if ((!allowEmpty && !trimmed) || [...trimmed].length > max) fail(`${label}长度应为1至${max}个字符`);
  return trimmed;
}
const maskPhone = phone => `${phone.slice(0,3)}****${phone.slice(-4)}`;
class EventStore {
  constructor({dataFile = path.join(__dirname,'data','lan-event.json')} = {}) {
    this.dataFile=path.resolve(dataFile); this.queue=Promise.resolve();
    const existed=fs.existsSync(this.dataFile);
    this.state=existed ? JSON.parse(fs.readFileSync(this.dataFile,'utf8').replace(/^\uFEFF/,'')) : freshEvent();
    const s=this.state;
    if (s.schemaVersion!==1 || !s.event || typeof s.event.id!=='string' || typeof s.event.registrationOpen!=='boolean' || !Array.isArray(s.participants) || !Array.isArray(s.prizes) || !Array.isArray(s.rounds) || !Array.isArray(s.lockedParticipantIds) || !Number.isSafeInteger(s.version)) throw new Error('活动数据损坏，请恢复备份后重试');
    const needsGeneration=s.event.drawGeneration===undefined;
    if(needsGeneration)s.event.drawGeneration=randomUUID();
    if(typeof s.event.drawGeneration!=='string'||!s.event.drawGeneration)throw new Error('活动抽奖版本损坏，请恢复备份后重试');
    if(!existed||needsGeneration)this.commit(this.state);
  }
  snapshot(state=this.state) {
    const won=new Set(state.rounds.flatMap(r=>r.winners.map(w=>w.id)));
    const eligible=state.event.registrationOpen ? state.participants.map(p=>p.id) : state.lockedParticipantIds;
    return clone({event:state.event,participants:state.participants,prizes:state.prizes,rounds:state.rounds,availableCount:eligible.filter(id=>!won.has(id)).length,version:state.version});
  }
  publicStatus(eventId) {
    if (eventId && eventId!==this.state.event.id) fail('活动二维码已失效，请重新扫码',409);
    const {id,title,registrationOpen}=this.state.event;
    return {event:{id,title,registrationOpen},count:this.state.participants.length};
  }
  commit(state) {
    const dir=path.dirname(this.dataFile);fs.mkdirSync(dir,{recursive:true});
    const temp=path.join(dir,`.${path.basename(this.dataFile)}.${randomUUID()}.tmp`);
    let fd;
    try {
      fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(state,null,2),'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      fs.renameSync(temp,this.dataFile);
      // Windows does not support directory fsync. On systems that do, flush the rename.
      if(process.platform!=='win32'){let dirFd;try{dirFd=fs.openSync(dir,'r');fs.fsyncSync(dirFd);}finally{if(dirFd!==undefined)fs.closeSync(dirFd);}}
    } finally { if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp); }
  }
  transact(change) {
    const pending=this.queue.then(()=>{
      const draft=clone(this.state);const result=change(draft);
      if(result && result.noChange) return result.value;
      draft.version+=1;this.commit(draft);this.state=draft;
      return result && result.round ? {round:clone(result.round),snapshot:this.snapshot()} : result && result.participant ? {participant:clone(result.participant)} : this.snapshot();
    });
    this.queue=pending.catch(()=>{});return pending;
  }
  register(body = {}) {
    return this.transact(s=>{
      if(body.eventId!==s.event.id) fail('活动二维码已失效，请重新扫码',409);
      if(!s.event.registrationOpen) fail('报名已关闭',409);
      const name=printable(body.name,'姓名',30);const phone=normalizePhone(body.phone);
      if(s.participants.some(p=>p.phone===phone)) fail('该手机号已经报名',409);
      const participant={id:randomUUID(),name,phone,joinedAt:now()};s.participants.push(participant);
      return {participant:{id:participant.id,name,phoneMasked:maskPhone(phone),joinedAt:participant.joinedAt}};
    });
  }
  setRegistration(open) {
    return this.transact(s=>{
      if(typeof open!=='boolean') fail('报名状态格式不正确');
      if(open && s.rounds.length) fail('已有抽奖结果，请先重置结果再开放报名',409);
      if(s.event.registrationOpen===open)return{noChange:true,value:this.snapshot(s)};
      s.event.registrationOpen=open;s.lockedParticipantIds=open?[]:s.participants.map(p=>p.id);
    });
  }
  removeParticipant(id) {
    return this.transact(s=>{
      if(!s.event.registrationOpen) fail('报名关闭后不能删除参与者',409);
      const index=s.participants.findIndex(p=>p.id===id);if(index<0)fail('参与者不存在',404);
      s.participants.splice(index,1);
    });
  }
  configure(body = {}) {
    return this.transact(s=>{
      if(s.rounds.length)fail('请先重置抽奖结果再修改奖品',409);
      const title=printable(body.title,'活动标题',80);
      if(!Array.isArray(body.prizes)||body.prizes.length<1||body.prizes.length>20)fail('请设置1至20个奖项');
      const types=new Set();
      const prizes=body.prizes.map(p=>{
        if(!p||!Number.isSafeInteger(p.type)||p.type<1||types.has(p.type))fail('奖项编号必须是唯一的正整数');types.add(p.type);
        if(!Number.isSafeInteger(p.count)||p.count<1||p.count>10000||!Number.isSafeInteger(p.perDraw)||p.perDraw<1||p.perDraw>p.count)fail('奖品数量或每轮数量不正确');
        const img=typeof p.img==='string'?p.img:'';if(img.length>300|| (img && !/^\/?(?:img|images|assets)\/[\w./-]+$/.test(img)))fail('奖品图片必须使用本地图片路径');
        return {type:p.type,text:printable(p.text,'奖项名称',50),title:printable(p.title??'','奖品说明',100,true),count:p.count,perDraw:p.perDraw,img};
      });
      s.event.title=title;s.prizes=prizes;
    });
  }
  draw(body = {}) {
    return this.transact(s=>{
      const {eventId,drawGeneration,prizeType,count,requestId}=body;
      if(typeof eventId!=='string'||!eventId||typeof drawGeneration!=='string'||!drawGeneration)fail('抽奖请求缺少活动或版本标识');
      if(eventId!==s.event.id||drawGeneration!==s.event.drawGeneration)fail('活动或抽奖结果已重置，请刷新后重新抽奖',409);
      if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(requestId))fail('抽奖请求编号格式不正确');
      if(!Number.isSafeInteger(prizeType)||!Number.isSafeInteger(count)||count<1)fail('抽奖数量或奖项不正确');
      const previous=s.rounds.find(r=>r.requestId===requestId);
      if(previous){if(previous.prizeType!==prizeType||previous.winners.length!==count)fail('该抽奖请求编号已用于不同抽奖参数',409);return{noChange:true,value:{round:clone(previous),snapshot:this.snapshot(s)}};}
      if(s.event.registrationOpen)fail('请先关闭报名再抽奖',409);
      const prize=s.prizes.find(p=>p.type===prizeType);if(!prize)fail('奖项不存在',404);
      if(count>prize.perDraw)fail('抽奖人数不能超过每轮设置人数');
      const already=s.rounds.filter(r=>r.prizeType===prizeType).reduce((n,r)=>n+r.winners.length,0);
      if(count>prize.count-already)fail('该奖项剩余名额不足',409);
      const won=new Set(s.rounds.flatMap(r=>r.winners.map(w=>w.id)));const locked=new Set(s.lockedParticipantIds);
      const pool=s.participants.filter(p=>locked.has(p.id)&&!won.has(p.id));
      if(count>pool.length)fail('未中奖参与者人数不足',409);
      const winners=[];for(let i=0;i<count;i++){const [p]=pool.splice(randomInt(pool.length),1);winners.push({id:p.id,name:p.name,phone:p.phone});}
      const round={id:randomUUID(),requestId,prizeType,prizeName:prize.text,winners,createdAt:now()};s.rounds.push(round);return{round};
    });
  }
  reset(scope) {
    return this.transact(s=>{
      if(!['all','results'].includes(scope))fail('重置范围不正确');
      if(scope==='all'){const fresh=freshEvent(s.event.title,s.prizes);fresh.version=s.version;Object.assign(s,fresh);}
      else{s.rounds=[];s.lockedParticipantIds=[];s.event.registrationOpen=true;s.event.drawGeneration=randomUUID();}
    });
  }
}
module.exports={EventStore,EventError,normalizePhone,maskPhone};
