/**
 * 极简 CDP 客户端：起一个 headless Edge、连上 DevTools 协议、在页面里跑任意 JS。
 * Node 22+ 自带 WebSocket，不需要额外依赖。
 *
 * 用法: node cdp.cjs <页面URL> <要注入并执行的js文件> [等待毫秒]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Edge 装在带版本号的目录里，升级一次路径就变，所以按通配找最新的一份。
function findEdge() {
  const roots = [
    'C:/Program Files (x86)/Microsoft/EdgeCore',
    'C:/Program Files/Microsoft/EdgeCore',
    'C:/Program Files (x86)/Microsoft/Edge/Application',
    'C:/Program Files/Microsoft/Edge/Application',
  ];
  const cands = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d, 'msedge.exe');
      if (fs.existsSync(p)) cands.push(p);
    }
  }
  if (cands.length) return cands.sort().pop();
  return 'msedge';   // 交给 PATH
}
const EDGE = process.env.EDGE_PATH || findEdge();
const PORT = 9333;
const URL_ = process.argv[2] || 'http://localhost:9245/';
const SCRIPT = process.argv[3];
const WAIT = Number(process.argv[4] || 15000);

const profile = path.join(os.tmpdir(), 'edge-cdp-profile');
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--enable-logging=stderr', '--v=0',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let logs = [];
child.stderr.on('data', (b) => logs.push(b.toString()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('CDP 没起来');
}

(async () => {
  const page = await targets();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  const send = (method, params = {}) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  await send('Page.navigate', { url: URL_ });
  await sleep(WAIT);

  // 收集控制台里已经出现的报错
  const consoleMsgs = events
    .filter((e) => e.method === 'Runtime.consoleAPICalled')
    .map((e) => ({
      type: e.params.type,
      text: e.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
    }))
    .filter((m) => m.type === 'error' || m.type === 'warning');

  console.log('=== 页面加载期 console.error/warning ===');
  for (const m of consoleMsgs) console.log(`[${m.type}]`, String(m.text).slice(0, 400));

  if (SCRIPT) {
    const code = fs.readFileSync(SCRIPT, 'utf8');
    const res = await send('Runtime.evaluate', {
      expression: code,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    console.log('=== 注入脚本结果 ===');
    if (res.result?.exceptionDetails) {
      console.log('抛异常:', JSON.stringify(res.result.exceptionDetails, null, 2).slice(0, 3000));
    } else {
      console.log(JSON.stringify(res.result?.result?.value, null, 2)?.slice(0, 6000));
    }
  }

  console.log('=== 注入后新产生的 console 输出 ===');
  const after = events
    .filter((e) => e.method === 'Runtime.consoleAPICalled')
    .map((e) => ({
      type: e.params.type,
      text: e.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
    }));
  for (const m of after.slice(-80)) console.log(`[${m.type}]`, String(m.text).slice(0, 500));

  ws.close();
  child.kill();
  process.exit(0);
})().catch((e) => { console.error('harness 失败:', e); child.kill(); process.exit(1); });
