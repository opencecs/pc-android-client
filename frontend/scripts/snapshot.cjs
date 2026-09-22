/**
 * App.vue 拆分回归快照工具。
 *
 * 本仓库没有测试框架扑面。这个脚本用 @vue/compiler-sfc 对 App.vue 生成三份
 * 可 diff 的快照，用来证明「拆分前后行为等价」：
 *
 *   1. template    —— <template> 编译出的 render 代码（阶段 1-3 必须逐字节相同）
 *   2. bindings    —— <script setup> 顶层绑定名集合（排序后）
 *   3. unresolved  —— 模板引用但顶层作用域解析不到的名字（白名单外应保持不变）
 *
 * 用法：
 *   node scripts/snapshot.cjs save <App.vue路径> <输出目录>
 *   node scripts/snapshot.cjs diff <基线目录> <对比目录>
 */
const fs = require('fs');
const path = require('path');

const sfc = require('@vue/compiler-sfc');

// 模板里合法引用、但不需要在 <script setup> 里声明的全局对象
const GLOBALS = new Set([
  'true', 'false', 'null', 'undefined', 'this',
  'Math', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Object', 'Array',
  'RegExp', 'Map', 'Set', 'Promise', 'Symbol', 'Error', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'console',
  'window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'Blob', 'File', 'FileReader', 'FormData', 'URL', 'Image', 'Audio', 'fetch',
  'Infinity', 'NaN', 'globalThis', 'arguments', 'undefined',
]);

function collectBindingNames(scriptContent) {
  // 用 @babel/parser 解析 <script setup>，取顶层声明名。
  // 与 App.vue 现有的声明风格一致（顶层 const/let/function），不做花哨处理。
  const parser = require('@babel/parser');
  const ast = parser.parse(scriptContent, {
    sourceType: 'module',
    plugins: ['jsx'],
    errorRecovery: true,
  });
  const names = new Set();
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers) {
        if (spec.local) names.add(spec.local.name);
      }
    } else if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (d.id.type === 'Identifier') names.add(d.id.name);
        else if (d.id.type === 'ObjectPattern') {
          for (const p of d.id.properties) {
            const v = p.value || p.argument;
            if (v && v.name) names.add(v.name);
          }
        } else if (d.id.type === 'ArrayPattern') {
          for (const el of d.id.elements) if (el && el.name) names.add(el.name);
        }
      }
    } else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
      if (node.id) names.add(node.id.name);
    } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const decl = node.declaration;
      if (decl.id) names.add(decl.id.name);
      if (decl.declarations) {
        for (const d of decl.declarations) {
          if (d.id && d.id.name) names.add(d.id.name);
        }
      }
    }
  }
  return names;
}

function collectTemplateIdentifiers(ast) {
  // 从模板 AST 里收集所有被引用的根标识符（取表达式的最左标识符）。
  const ids = new Set();
  const walkExpr = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walkExpr);
    switch (node.type) {
      case 'Identifier':
        ids.add(node.name);
        return;
      case 'MemberExpression':
        walkExpr(node.object); // 只关心根对象，不关心 .prop
        return;
      case 'SimpleExpressionNode':
        // 未解析的表达式（v-if 里的普通绑定等），用正则兜底抓标识符
        if (typeof node.content === 'string') {
          const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)/g;
          let m;
          while ((m = re.exec(node.content))) ids.add(m[2]);
        }
        return;
      default:
        for (const k of Object.keys(node)) {
          if (k === 'loc' || k === 'type' || k === 'comments') continue;
          const v = node[k];
          if (v && typeof v === 'object') walkExpr(v);
        }
    }
  };
  walkExpr(ast);
  return ids;
}

function snapshot(file, outDir) {
  // 统一行尾：工作区是 CRLF、git blob 可能是 LF，不归一化会导致假 diff
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const { descriptor, errors } = sfc.parse(source, { filename: file });
  if (errors && errors.length) {
    throw new Error('SFC parse errors: ' + errors.map(e => e.message).join('; '));
  }

  const result = {};

  // 1. 模板编译产物
  const tplSrc = descriptor.template ? descriptor.template.content : '';
  const compiled = sfc.compileTemplate({
    source: tplSrc,
    filename: file,
    id: 'app-snapshot',
    compilerOptions: { mode: 'module' },
  });
  if (compiled.errors && compiled.errors.length) {
    throw new Error('template compile errors: ' + compiled.errors.map(String).join('; '));
  }
  result.template = compiled.code;

  // 2. script setup 顶层绑定名
  const scriptContent = descriptor.scriptSetup ? descriptor.scriptSetup.content : '';
  const bindings = collectBindingNames(scriptContent);
  result.bindings = [...bindings].sort();

  // 3. 模板引用但顶层解析不到的名字
  let unresolved = [];
  if (descriptor.template && descriptor.template.ast) {
    const used = collectTemplateIdentifiersRaw(descriptor.template.ast);
    unresolved = [...used]
      .filter((n) => !bindings.has(n) && !GLOBALS.has(n) && !n.startsWith('_'))
      .sort();
  }
  result.unresolved = unresolved;

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'template.js'), result.template, 'utf8');
  fs.writeFileSync(path.join(outDir, 'bindings.txt'), result.bindings.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'unresolved.txt'), result.unresolved.join('\n') + '\n', 'utf8');
  return result;
}

// 直接从模板源码里抓标识符（比走 AST 更耐操，避免遍历到编译器内部节点）
function collectTemplateIdentifiersRaw(ast) {
  const ids = new Set();
  const seen = new WeakSet();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === 'Interpolation' && node.content) {
      scanExpr(node.content.content, ids);
    } else if (node.type === 'Directive' && node.exp) {
      scanExpr(node.exp.content, ids);
    } else if (node.type === 'Identifier') {
      ids.add(node.name);
    } else if (node.type === 'SimpleExpressionNode') {
      scanExpr(node.content, ids);
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'parent') continue;
      const v = node[k];
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(ast);
  return ids;
}

function scanExpr(src, ids) {
  if (typeof src !== 'string') return;
  // 去掉字符串字面量和属性访问的 .prop，剩下的标识符就是根引用
  const cleaned = src
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, ' ');
  const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(cleaned))) ids.add(m[2]);
}

const [cmd, a, b] = process.argv.slice(2);

if (cmd === 'save') {
  const r = snapshot(a, b);
  console.log(`snapshot -> ${b}`);
  console.log(`  template.js   ${r.template.length} bytes`);
  console.log(`  bindings.txt  ${r.bindings.length} names`);
  console.log(`  unresolved    ${r.unresolved.length} names`);
} else if (cmd === 'diff') {
  const files = ['template.js', 'bindings.txt', 'unresolved.txt'];
  let failed = 0;
  for (const f of files) {
    const pa = path.join(a, f), pb = path.join(b, f);
    if (!fs.existsSync(pa) || !fs.existsSync(pb)) {
      console.log(`?? ${f}: missing (${fs.existsSync(pa) ? 'baseline ok' : 'baseline MISSING'}, ${fs.existsSync(pb) ? 'current ok' : 'current MISSING'})`);
      failed++;
      continue;
    }
    const ca = fs.readFileSync(pa, 'utf8'), cb = fs.readFileSync(pb, 'utf8');
    if (ca === cb) {
      console.log(`OK ${f}`);
    } else {
      failed++;
      const la = ca.split('\n'), lb = cb.split('\n');
      const onlyA = la.filter(x => x && !lb.includes(x));
      const onlyB = lb.filter(x => x && !la.includes(x));
      console.log(`DIFF ${f}  (-${onlyA.length} +${onlyB.length})`);
      onlyA.slice(0, 40).forEach(x => console.log('   - ' + x.slice(0, 120)));
      onlyB.slice(0, 40).forEach(x => console.log('   + ' + x.slice(0, 120)));
      if (onlyA.length > 40 || onlyB.length > 40) console.log('   ... (truncated)');
    }
  }
  process.exit(failed ? 1 : 0);
} else {
  console.error('usage: node scripts/snapshot.cjs save <App.vue> <outDir> | diff <baselineDir> <currentDir>');
  process.exit(2);
}
