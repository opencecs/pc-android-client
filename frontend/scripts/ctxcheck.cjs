const fs = require('fs');
const sfc = require('@vue/compiler-sfc');

// 渲染代理上合法可用的全局属性 / 内建对象
const OK = new Set([
  '$t', '$i18n', '$options', '$props', '$slots', '$attrs', '$emit', '$el', '$refs',
  '$nextTick', '$forceUpdate', '$watch', '$data', '$root', '$parent', '$appContext',
  '$children', '$host', '$style', '$suspense',
  'Math', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Object', 'Array', 'RegExp',
  'Map', 'Set', 'Promise', 'Symbol', 'Error', 'parseInt', 'parseFloat', 'isNaN',
  'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'console', 'window',
  'document', 'localStorage', 'sessionStorage', 'navigator', 'location', 'undefined',
  'Infinity', 'NaN', 'true', 'false', 'null', 'arguments',
]);

let bad = 0;
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  const { descriptor, errors } = sfc.parse(src, { filename: file });
  if (errors.length) { console.log(file, 'PARSE ERROR', errors.map(e => e.message)); bad++; continue; }
  let out;
  try {
    out = sfc.compileScript(descriptor, { id: file, inlineTemplate: true }).content;
  } catch (e) { console.log(file, 'COMPILE ERROR', e.message); bad++; continue; }
  const names = new Set();
  for (const m of out.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  const suspicious = [...names].filter(n => !OK.has(n)).sort();
  const extra = errors.length ? ' parseErrors=' + errors.length : '';
  if (suspicious.length) {
    console.log(`${file}\n   未解析: ${suspicious.join(' ')}`);
    bad++;
  } else {
    console.log(`${file}  ok (仅 ${[...names].sort().join(' ') || '无'} 这类全局属性)`);
  }
}
console.log(bad ? `\n${bad} 个文件有可疑引用` : '\n全部通过');
