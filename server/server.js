const path=require('node:path');
const {spawn}=require('node:child_process');
const {createApp,networkInfo}=require('./lan-app');
function openBrowser(url) {
  const command=process.platform==='win32'?'rundll32':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  const child=spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true});child.on('error',()=>{});child.unref();
}
function listenWithRetry(app,startPort=8888,shouldOpen=false,retries=100) {
  return new Promise((resolve,reject)=>{
    const first=Number(startPort);if(!Number.isInteger(first)||first<0||first>65535)return reject(new Error('端口必须为0至65535之间的整数'));
    function attempt(current,remaining) {
      const server=app.listen(current,'0.0.0.0');
      server.once('error',err=>{
        if(err.code==='EADDRINUSE'&&remaining>1&&current<65535){console.log(`[lottery] 端口 ${current} 被占用，尝试 ${current+1}`);attempt(current+1,remaining-1);}
        else reject(err);
      });
      server.once('listening',()=>{
        const actual=server.address().port;const url=`http://127.0.0.1:${actual}`;console.log(`[lottery] 本机管理页面：${url}`);
        const info=networkInfo(actual,app.locals.store.snapshot().event.id);for(const item of info.addresses)console.log(`[lottery] ${item.name} 报名地址：${item.joinUrl}`);
        if(shouldOpen)openBrowser(url);resolve(server);
      });
    }
    attempt(first,retries);
  });
}
function run(port=8888,noOpen) {
  const app=createApp({staticDir:path.join(__dirname,'..','product','dist')});
  return listenWithRetry(app,port,String(noOpen||'').toLowerCase()!=='n').catch(err=>{console.error(`[lottery] 无法启动：${err.message}`);process.exitCode=1;throw err;});
}
module.exports={run,createApp,listenWithRetry};
