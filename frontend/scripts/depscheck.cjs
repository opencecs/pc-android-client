/**
 * 检查 App.vue 里每个 useXxx({...}, {...}) 调用点的实参是否与 composable 的形参对位。
 *
 * 为什么需要：composable 的签名是 `useXxx(deps, lazyDeps = {})` —— 第一参是立即解构的
 * 依赖，第二参是"下方才声明、惰性取用"的依赖。把本该进第二参的名字写进第一参时，
 * 它不会被解构，值恒为 undefined；setup 不报错、构建也过，但运行时一调用就
 * "xxx is not a function" / 静默失效。这类错位只能靠对位检查发现。
 *
 * 第二遍还查另一类静默失效：把 App.vue 的**模块级 let/var 按值**传进 composable。
 * `let x = false` 被解构进 composable 后就冻成了调用那一刻的快照，之后 App.vue 里
 * 再改 x，composable 里读到的永远是旧值 —— 于是 `if (x) doSomething()` 这类守卫
 * 恒不成立，功能整块不跑。要传就传取值函数 `() => x`（函数体是延迟执行的，
 * 所以箭头函数不会被这一遍报出来）。
 *
 * 用法: node depscheck.cjs <App.vue> <composables目录>
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const appSrc = fs.readFileSync(process.argv[2], 'utf8');
const script = appSrc.slice(appSrc.indexOf('<script setup>') + 14, appSrc.lastIndexOf('</script>'));
const ast = parser.parse(script, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true });

function patternNames(node, out) {
  if (!node) return;
  if (node.type === 'Identifier') { out.push(node.name); return; }
  if (node.type === 'ObjectPattern') {
    for (const p of node.properties) {
      if (p.type === 'RestElement') patternNames(p.argument, out);
      else patternNames(p.value, out);
    }
    return;
  }
  if (node.type === 'ArrayPattern') { for (const el of node.elements) patternNames(el, out); return; }
  if (node.type === 'AssignmentPattern') patternNames(node.left, out);
  if (node.type === 'RestElement') patternNames(node.argument, out);
}

// 1) 收集 composable 的形参：arg1 的名字集合 + arg2 的名字集合
function composableParams(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = parser.parse(src, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true });
  for (const st of a.program.body) {
    if (st.type !== 'ExportNamedDeclaration' || !st.declaration) continue;
    const fn = st.declaration;
    if (fn.type !== 'FunctionDeclaration') continue;
    const p0 = fn.params[0], p1 = fn.params[1];
    const direct = [];
    if (p0 && p0.type === 'ObjectPattern') patternNames(p0, direct);
    // 第二参通常叫 lazyDeps，函数体里 `const { ... } = lazyDeps` 才是真正取用的名字
    const lazy = [];
    let lazyParam = null;
    // 第二参常写成 `lazyDeps = {}` —— 那是 AssignmentPattern，名字在 .left 上
    const p1id = p1 && p1.type === 'AssignmentPattern' ? p1.left : p1;
    if (p1id && p1id.type === 'Identifier') lazyParam = p1id.name;
    if (lazyParam) {
      for (const s of fn.body.body) {
        if (s.type === 'VariableDeclaration' && s.declarations[0] &&
            s.declarations[0].init && s.declarations[0].init.type === 'Identifier' &&
            s.declarations[0].init.name === lazyParam) {
          patternNames(s.declarations[0].id, lazy);
        }
      }
    }
    return { name: fn.id.name, direct, lazy, hasLazyParam: !!lazyParam };
  }
  return null;
}

const dir = process.argv[3];
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const f = path.join(dir, name + '.js');
  const v = fs.existsSync(f) ? composableParams(f) : null;
  cache.set(name, v);
  return v;
}

let problems = 0, checked = 0;

// 0) App.vue 的模块级 let/var —— 这些是"会被重新赋值"的绑定，按值传进 composable 必冻成快照
const mutableToplevel = new Set();
for (const st of ast.program.body) {
  if (st.type !== 'VariableDeclaration' || st.kind === 'const') continue;
  for (const d of st.declarations) {
    const names = [];
    patternNames(d.id, names);
    for (const n of names) mutableToplevel.add(n);
  }
}

// 调用点有两种写法：`const {...} = useXxx({...})` 与不取返回值的裸调用 `useXxx({...})`
const inits = [];
for (const st of ast.program.body) {
  if (st.type === 'VariableDeclaration') {
    for (const d of st.declarations) if (d.init) inits.push(d.init);
  } else if (st.type === 'ExpressionStatement') {
    inits.push(st.expression);
  }
}
for (const init of inits) {
  {
    if (!init || init.type !== 'CallExpression') continue;
    if (init.callee.type !== 'Identifier' || !/^use[A-Z]/.test(init.callee.name)) continue;
    const sig = load(init.callee.name);
    if (!sig) continue;
    checked++;
    const line = script.slice(0, init.start).split('\n').length;
    const arg1 = init.arguments[0] && init.arguments[0].type === 'ObjectExpression'
      ? init.arguments[0].properties.map((p) => (p.computed ? null : p.key.name || p.key.value)).filter(Boolean)
      : [];
    const arg2 = init.arguments[1] && init.arguments[1].type === 'ObjectExpression'
      ? init.arguments[1].properties.map((p) => (p.computed ? null : p.key.name || p.key.value)).filter(Boolean)
      : [];
    const s1 = new Set(arg1), s2 = new Set(arg2);
    const msgs = [];
    // 模块级 let/var 按值传入 → 在 composable 里是调用那一刻的快照，之后再变也看不到
    const frozen = [];
    for (const arg of [init.arguments[0], init.arguments[1]]) {
      if (!arg || arg.type !== 'ObjectExpression') continue;
      for (const p of arg.properties) {
        if (p.type !== 'ObjectProperty' || p.computed) continue;
        if (p.value && p.value.type === 'Identifier' && mutableToplevel.has(p.value.name)) {
          frozen.push(p.value.name);
        }
      }
    }
    if (frozen.length) {
      msgs.push('模块级 let/var 按值传入（composable 里会冻成快照，改用 `() => 名`）: ' + [...new Set(frozen)].join(' '));
    }
    // 该进第二参却写进了第一参 → 运行时恒为 undefined
    const misplaced = sig.lazy.filter((k) => s1.has(k) && !s2.has(k));
    if (misplaced.length) msgs.push('惰性依赖写进了第一参（运行时为 undefined）: ' + misplaced.join(' '));
    // composable 需要但两边都没给
    const missing = sig.lazy.filter((k) => !s1.has(k) && !s2.has(k));
    if (missing.length) msgs.push('惰性依赖缺失: ' + missing.join(' '));
    const missingDirect = sig.direct.filter((k) => !s1.has(k));
    if (missingDirect.length) msgs.push('第一参依赖缺失: ' + missingDirect.join(' '));
    if (!sig.hasLazyParam && s2.size) msgs.push('composable 无第二参，但调用点传了: ' + arg2.join(' '));
    // 传了但 composable 没解构 → 静默丢弃，多半是名字改了
    const extraLazy = arg2.filter((k) => !sig.lazy.includes(k));
    if (sig.hasLazyParam && extraLazy.length) msgs.push('第二参传了但 composable 未解构（被静默丢弃）: ' + extraLazy.join(' '));
    if (msgs.length) {
      console.log('✗ ' + sig.name + '  调用在源码第 ' + line + ' 行');
      for (const m of msgs) console.log('      ' + m);
      problems++;
    }
  }
}
console.log(problems ? '\n' + problems + ' 处实参错位（检查了 ' + checked + ' 个 composable 调用）'
                    : '\n全部对位（检查了 ' + checked + ' 个 composable 调用）');
