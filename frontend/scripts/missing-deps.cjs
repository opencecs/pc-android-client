/**
 * 找出 composable 里引用了、但没通过 deps 传进来的名字——这些是运行时 ReferenceError。
 *
 * free-vars.cjs 只知道"这个名字在本文件里没绑定"，但没法区分「App.vue 里的顶层绑定（=漏传的依赖）」
 * 和「真正的全局对象」。本脚本拿 App.vue 的顶层绑定表来对照，把前者挑出来。
 *
 * 顺带算出该依赖在 App.vue 里的声明行 vs composable 调用行：
 * 声明行 > 调用行 => 必须写成 lazyDeps（箭头函数），否则 TDZ 报错。
 *
 * 用法: node missing-deps.cjs <App.vue> <composable.js...>
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const { analyze } = require('./free-vars.cjs');

const appFile = process.argv[2];
const composables = process.argv.slice(3);

const raw = fs.readFileSync(appFile, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const text = raw.replace(/\r\n/g, '\n');

// ---- App.vue 顶层绑定表：名字 -> 行号 ----
const scriptOff = text.indexOf('<script setup>') + '<script setup>'.length;
const scriptSrc = text.slice(scriptOff, text.indexOf('</script>', scriptOff));
const scriptStartLine = text.slice(0, scriptOff).split('\n').length; // <script setup> 所在行

const ast = parser.parse(scriptSrc, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true });

const appBindings = new Map(); // name -> 文件绝对行号
const collectPattern = (p) => {
  if (!p || typeof p !== 'object') return;
  if (Array.isArray(p)) return p.forEach(collectPattern);
  switch (p.type) {
    case 'Identifier': if (!appBindings.has(p.name)) appBindings.set(p.name, lineOf(p)); return;
    case 'ObjectPattern': p.properties.forEach(collectPattern); return;
    case 'ArrayPattern': p.elements.forEach(collectPattern); return;
    case 'AssignmentPattern': collectPattern(p.left); return;
    case 'RestElement': collectPattern(p.argument); return;
    case 'ObjectProperty':
    case 'Property': collectPattern(p.value); return;
    default: return;
  }
};
function lineOf(node) {
  return scriptStartLine + scriptSrc.slice(0, node.start).split('\n').length - 1;
}

// 顶层声明 -> 绑定名
for (const node of ast.program.body) {
  if (node.type === 'VariableDeclaration') {
    for (const d of node.declarations) collectPattern(d.id);
  } else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
    if (node.id) appBindings.set(node.id.name, lineOf(node.id));
  } else if (node.type === 'ImportDeclaration') {
    for (const s of node.specifiers) {
      if (s.local && !appBindings.has(s.local.name)) appBindings.set(s.local.name, lineOf(s.local));
    }
  }
}

// ---- composable 调用行：`} = useXxx({` 或 `= useXxx(` 所在行 ----
const callLines = new Map(); // useName -> 行号
{
  const re = /=\s*(use[A-Za-z0-9_$]+)\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    const ln = text.slice(0, m.index).split('\n').length;
    if (!callLines.has(m[1])) callLines.set(m[1], ln);
  }
}

let missing = 0;
for (const file of composables) {
  const useName = path.basename(file, '.js');
  const { free } = analyze(file);
  const hits = [];
  const globals = [];
  for (const [name, ln] of free) {
    if (appBindings.has(name)) hits.push([name, ln, appBindings.get(name)]);
    else globals.push([name, ln]);
  }
  const callLine = callLines.get(useName);
  console.log(`\n=== ${useName}  (调用行 ${callLine == null ? '?' : callLine}) ===`);
  if (!hits.length) console.log('  无漏传依赖');
  for (const [name, ln, appLn] of hits) {
    missing++;
    const lazy = callLine != null && appLn > callLine;
    console.log(`  漏传  ${name}  (composable:${ln}  App.vue:${appLn})${lazy ? '   <<< 需 lazyDeps' : ''}`);
  }
  if (globals.length) {
    console.log('  真全局（App.vue 里也没有，忽略）: ' + globals.map(([n]) => n).join(', '));
  }
}
console.log(`\n合计漏传 ${missing} 处`);
