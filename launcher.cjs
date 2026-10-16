const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const validPort = port => Number.isInteger(port) && port >= 1 && port <= 65535;
function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
function readRecord(file) {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isInteger(record.pid) || record.pid < 1 || typeof record.token !== 'string' || !record.token || !(record.port === null || validPort(record.port))) return { invalid: true };
    return record;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { invalid: true };
  }
}
function writeExclusive(file, record) {
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(record));
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) { fs.closeSync(fd); fd = undefined; fs.unlinkSync(file); }
    throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function removeOwned(file, token) {
  if (readRecord(file)?.token === token) fs.unlinkSync(file);
}
function openLocalBrowser(url) {
  const program = process.platform === 'win32' ? 'rundll32' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(program, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log('浏览器未能自动打开，请复制上方本机地址。'));
  child.unref();
}
async function acquireLock(lockFile, record, waitMs) {
  const guardFile = lockFile + '.reclaim';
  const deadline = Date.now() + waitMs;
  while (true) {
    const guard = readRecord(guardFile);
    if (guard) {
      if (Date.now() >= deadline) throw new Error('启动锁文件正在恢复或已损坏。请先关闭所有抽奖窗口，确认没有抽奖进程，再删除 lan-process.lock.reclaim 后重试。');
      await sleep(50); continue;
    }
    try { writeExclusive(lockFile, record); return { owned: true }; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const existing = readRecord(lockFile);
    if (!existing) continue;
    if (existing.invalid) {
      if (Date.now() >= deadline) throw new Error('启动锁文件损坏。请先关闭所有抽奖窗口，确认没有抽奖进程，再删除 server/data/lan-process.lock 后重试。');
      await sleep(50); continue;
    }
    if (isAlive(existing.pid)) {
      if (validPort(existing.port)) return { owned: false, port: existing.port };
      if (Date.now() >= deadline) throw new Error('抽奖程序已经启动，正在等待服务地址。请查看已有控制台窗口。');
      await sleep(50); continue;
    }
    // Only one reclaimer may inspect/delete a dead owner's lock at a time.
    // A stale or malformed recovery guard fails closed rather than deleting a
    // file that might belong to a still-running writer.
    try { writeExclusive(guardFile, record); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    try {
      const latest = readRecord(lockFile);
      if (latest && !latest.invalid && !isAlive(latest.pid)) removeOwned(lockFile, latest.token);
      try { writeExclusive(lockFile, record); return { owned: true }; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { removeOwned(guardFile, record.token); }
  }
}

async function runLauncher({
  dataDir = path.join(__dirname, 'server', 'data'),
  startPort = 8888,
  waitMs = 10000,
  openBrowser = openLocalBrowser,
  startServer = async () => {
    if (!fs.existsSync(path.join(__dirname, 'product', 'dist', 'index.html'))) throw new Error('缺少已构建页面 product/dist/index.html，请使用完整运行包或先完成构建。');
    return require('./server/server').run(startPort, 'n');
  }
} = {}) {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('需要 Node.js 20 或更新版本，请安装后重新启动。');
  fs.mkdirSync(dataDir, { recursive: true });
  const lockFile = path.join(dataDir, 'lan-process.lock');
  const record = { pid: process.pid, port: null, token: randomUUID(), startedAt: new Date().toISOString() };
  const acquired = await acquireLock(lockFile, record, waitMs);
  if (!acquired.owned) {
    const url = `http://127.0.0.1:${acquired.port}`;
    console.log(`抽奖程序已在运行，打开已有页面：${url}`);
    openBrowser(url);
    return { duplicate: true, port: acquired.port };
  }
  let server;
  const tempFile = `${lockFile}.${record.token}.tmp`;
  const cleanup = () => {
    try { removeOwned(lockFile, record.token); } catch {}
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
  };
  process.once('exit', cleanup);
  const stop = async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    cleanup();
    process.removeListener('exit', cleanup);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.removeListener(signal, onSignal);
  };
  const onSignal = () => { stop().finally(() => process.exit(0)); };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.once(signal, onSignal);
  try {
    server = await startServer();
    const port = server.address()?.port;
    if (!validPort(port)) throw new Error('服务没有返回有效的本机端口。');
    record.port = port;
    fs.writeFileSync(tempFile, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tempFile, lockFile);
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n本机管理页面：${url}\n请保持此窗口和电脑开启；结束活动后关闭窗口或按 Ctrl+C。`);
    openBrowser(url);
    return { duplicate: false, port, server, stop };
  } catch (error) { await stop(); throw error; }
}
if (require.main === module) runLauncher().catch(error => { console.error(`\n启动失败：${error.message}`); process.exitCode = 1; });
module.exports = { runLauncher };
