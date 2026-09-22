/**
 * 检查 composable 文件里有没有「自由变量」——引用了但既没在本文件任何地方绑定、
 * 也不是 import 进来、也不在 JS 内建白名单里的名字。
 *
 * 这类名字要么是漏传的依赖（运行时 ReferenceError），要么是漏 import。
 * range-deps.cjs 看不到 `const { x } = useFoo()` 这种解构出来的绑定，所以必须靠这一步兜底。
 *
 * 用法: node free-vars.cjs <文件...>
 */
const fs = require('fs');
const parser = require('@babel/parser');

const BUILTINS = new Set([
  'Math', 'JSON', 'Date', 'Number', 'String', 'Object', 'Array', 'RegExp', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Error', 'TypeError', 'RangeError', 'Boolean',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'NaN', 'Infinity', 'undefined', 'globalThis',
  'console', 'window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'queueMicrotask', 'structuredClone', 'atob', 'btoa',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'escape', 'unescape',
  'getComputedStyle', 'getSelection', 'matchMedia', 'alert', 'confirm', 'prompt',
  'Blob', 'File', 'FileReader', 'FormData', 'URL', 'URLSearchParams', 'Image', 'Audio',
  'fetch', 'AbortController', 'TextDecoder', 'TextEncoder', 'Event', 'CustomEvent',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'HTMLElement', 'Element',
  'Node', 'WebSocket', 'XMLHttpRequest', 'arguments', 'this', 'super', 'eval',
  'process', 'require', 'module', 'exports', 'Buffer', '__dirname', '__filename',
]);

function analyze(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true });

  // ---- 第一遍：收集所有"绑定位置"上的 Identifier ----
  // bindingNodes 用于在第二遍里跳过绑定位置本身；
  // boundNames 用于判断"这个名字在本文件里到底有没有被绑定过"（关键）。
  const bindingNodes = new WeakSet();
  const boundNames = new Set();

  const markPattern = (p) => {
    if (!p || typeof p !== 'object') return;
    if (Array.isArray(p)) return p.forEach(markPattern);
    switch (p.type) {
      case 'Identifier': bindingNodes.add(p); boundNames.add(p.name); return;
      case 'ObjectPattern': p.properties.forEach(markPattern); return;
      case 'ArrayPattern': p.elements.forEach(markPattern); return;
      case 'AssignmentPattern': markPattern(p.left); return;
      case 'RestElement': markPattern(p.argument); return;
      case 'ObjectProperty':
      case 'Property': markPattern(p.value); return;
      default: return;
    }
  };

  const collectBindings = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(collectBindings);
    switch (node.type) {
      case 'VariableDeclarator': markPattern(node.id); break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id) { bindingNodes.add(node.id); boundNames.add(node.id.name); }
        (node.params || []).forEach(markPattern);
        break;
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        if (node.local) { bindingNodes.add(node.local); boundNames.add(node.local.name); }
        break;
      case 'CatchClause': markPattern(node.param); break;
      // 对象字面量里的 getter/setter：set value(v) { ... } 的 v 是绑定，不是引用
      case 'ObjectMethod':
      case 'ClassMethod':
      case 'ClassPrivateMethod':
        (node.params || []).forEach(markPattern);
        break;
      // { foo: function (a) {} } / { foo: (a) => {} } 也要算上形参
      case 'ObjectProperty':
      case 'Property':
      case 'ClassProperty':
        if (node.value && /Function/.test(node.value.type)) (node.value.params || []).forEach(markPattern);
        break;
      default: break;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments') continue;
      const v = node[k];
      if (v && typeof v === 'object') collectBindings(v);
    }
  };
  collectBindings(ast.program);

  // ---- 第二遍：不在绑定位置的 Identifier 就是引用 ----
  const refs = new Map();
  const walk = (node, parent) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, parent));
    if (node.type === 'Identifier' && !bindingNodes.has(node)) {
      // 属性访问的 .prop、对象字面量的 key、标签名不算引用
      const isProp = parent && (
        ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parent.property === node && !parent.computed) ||
        ((parent.type === 'ObjectProperty' || parent.type === 'Property' || parent.type === 'ObjectMethod' ||
          parent.type === 'ClassMethod' || parent.type === 'ClassProperty') && parent.key === node && !parent.computed) ||
        parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement'
      );
      if (!isProp && !refs.has(node.name)) {
        refs.set(node.name, src.slice(0, node.start).split('\n').length);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments') continue;
      const v = node[k];
      if (v && typeof v === 'object') walk(v, node);
    }
  };
  walk(ast.program, null);

  const free = [...refs.entries()]
    .filter(([n]) => !BUILTINS.has(n) && !boundNames.has(n))
    .sort((a, b) => a[1] - b[1]);
  return { free, refCount: refs.size, boundCount: boundNames.size };
}

module.exports = { analyze, BUILTINS };

if (require.main === module) {
  let bad = 0;
  for (const file of process.argv.slice(2)) {
    const { free, boundCount } = analyze(file);
    if (free.length === 0) {
      console.log(`OK   ${file}  (${boundCount} 个绑定)`);
    } else {
      bad++;
      console.log(`FREE ${file}  (${boundCount} 个绑定)`);
      free.forEach(([n, ln]) => console.log(`       line ${ln}: ${n}`));
    }
  }
  process.exit(bad ? 1 : 0);
}
