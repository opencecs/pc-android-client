/**
 * 检查 App.vue 里每个 <XxxDialog> 调用点是否把子组件声明的 props 都绑上了。
 *
 * 漏绑的 prop 会静默取 default —— 这正是「拆分后行为悄悄变了」里最难发现的一类回归：
 * 模板编译得过、构建也过，但那个值永远是默认值。所以每次迁出弹窗后跑一遍。
 *
 * 用法: node propcheck.cjs <App.vue路径> <子组件目录>
 */
const fs = require('fs');
const path = require('path');
const sfc = require('@vue/compiler-sfc');

const ELEMENT = 1, ATTRIBUTE = 6, DIRECTIVE = 7;

const camelize = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());

// 1) 收集子组件声明的 props
function declaredProps(file) {
  const src = fs.readFileSync(file, 'utf8');
  const { descriptor } = sfc.parse(src, { filename: file });
  const script = descriptor.scriptSetup && descriptor.scriptSetup.content;
  if (!script) return null;
  const m = script.match(/defineProps\(\s*\{([\s\S]*?)\n\}\)/);
  if (!m) return new Set();
  const keys = new Set();
  let depth = 0;
  for (const line of m[1].split('\n')) {
    if (depth === 0) {
      const km = line.match(/^\s{2}([A-Za-z_$][\w$]*)\s*:/);
      if (km) keys.add(km[1]);
    }
    depth += (line.match(/[{([]/g) || []).length - (line.match(/[})\]]/g) || []).length;
  }
  return keys;
}

// 2) 收集子组件声明的事件
function declaredEmits(file) {
  const src = fs.readFileSync(file, 'utf8');
  const { descriptor } = sfc.parse(src, { filename: file });
  const script = descriptor.scriptSetup && descriptor.scriptSetup.content;
  if (!script) return null;
  const m = script.match(/defineEmits\(\[([\s\S]*?)\]\)/);
  if (!m) return new Set();
  return new Set([...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] || x[2]));
}

// 3) 走 App.vue 模板 AST，收集每个组件调用点上绑定的 prop 名 / 事件名
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const c of node.children || []) walk(c, visit);
  if (node.branches) for (const b of node.branches) walk(b, visit);
}

const appSrc = fs.readFileSync(process.argv[2], 'utf8');
const { descriptor } = sfc.parse(appSrc, { filename: process.argv[2] });
const bound = {};   // ComponentName -> Set<propName>
const handlers = {}; // ComponentName -> Set<eventName>
walk(descriptor.template.ast, (node) => {
  if (node.type !== ELEMENT || !/^[A-Z]/.test(node.tag)) return;
  if (!bound[node.tag]) bound[node.tag] = new Set();
  if (!handlers[node.tag]) handlers[node.tag] = new Set();
  for (const p of node.props || []) {
    if (p.type === ATTRIBUTE) bound[node.tag].add(camelize(p.name));
    else if (p.type === DIRECTIVE && p.arg) {
      if (p.name === 'model') {
        // v-model:x 同时绑 prop x 和监听 update:x
        bound[node.tag].add(camelize(p.arg.content));
        handlers[node.tag].add(camelize('update:' + p.arg.content));
      } else if (p.name === 'bind') bound[node.tag].add(camelize(p.arg.content));
      else if (p.name === 'on') handlers[node.tag].add(camelize(p.arg.content));
    }
  }
});

// 4) 对比
const dir = process.argv[3];
let problems = 0, checked = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.vue'))) {
  const name = path.basename(f, '.vue');
  if (!bound[name]) continue;              // 未在 App.vue 里用到，跳过
  const file = path.join(dir, f);
  const declared = declaredProps(file);
  if (!declared) continue;
  checked++;
  const missing = [...declared].filter((k) => !bound[name].has(k));
  const extra = [...bound[name]].filter((k) => !declared.has(k));
  if (missing.length) {
    console.log(`✗ ${name}  漏绑 prop: ${missing.join(' ')}`);
    problems++;
  }
  if (extra.length) console.log(`  ${name}  调用点多绑了 prop: ${extra.join(' ')}（子组件未声明，会落到 attrs）`);

  const emits = declaredEmits(file);
  const unhandled = [...emits].filter((k) => !handlers[name].has(camelize(k)));
  if (unhandled.length) {
    console.log(`✗ ${name}  事件无人监听: ${unhandled.join(' ')}`);
    problems++;
  }
  if (!missing.length && !unhandled.length) {
    console.log(`✓ ${name}  ${declared.size} 个 prop 全绑上，${emits.size} 个事件全有监听`);
  }
}
console.log(problems ? `\n${problems} 处问题（检查了 ${checked} 个组件）` : `\n全部通过（检查了 ${checked} 个组件）`);
