/**
 * TDZ 检查：App.vue 的 <script setup> 顶层语句里，「立即求值」的部分引用了
 * 在更下方才用 const/let/class 声明的名字。
 *
 * 为什么需要这个：拆分阶段 3 把状态留在 App.vue、逻辑搬进 composable 之后，
 * App.vue 顶层大量出现 `useXxx({ dep })` 这种写法 —— 它是在 setup 执行期求值 deps
 * 对象的，所以 `dep` 必须在那之前就初始化好。`const`/`let` 是 TDZ，提前读会直接
 * ReferenceError: Cannot access 'dep' before initialization —— 而这只在运行时炸，
 * 构建过、模板作用域检查也过，是「页面空白」的典型成因。
 *
 * 判断规则：
 *   - `function foo() {}` / `var foo` 会提升 → 安全
 *   - `const foo` / `let foo` / `class foo` 在更下方声明 → 报
 *   - 值写成箭头函数（`foo: (...a) => foo(...a)`）→ 调用时才读，安全
 *   - 箭头 / 函数表达式的函数体是延迟执行的 → 不下钻
 *   - import 语句、属性键（非 computed）不是引用 → 跳过
 *
 * 用法: node tdzcheck.cjs <App.vue>
 */
const fs = require('fs');
const parser = require('@babel/parser');

const src = fs.readFileSync(process.argv[2], 'utf8');
const script = src.slice(src.indexOf('<script setup>') + 14, src.lastIndexOf('</script>'));
const ast = parser.parse(script, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true });

const body = ast.program.body;

// 1) 顶层 const/let/class 的声明顺序（TDZ 敏感的）
//    注意：解构声明（`const { a, b } = useX(...)`）的 id 是 ObjectPattern/ArrayPattern，
//    必须把里面的每个名字都收进来 —— composable 的产出正是这样落到 App.vue 的。
function patternNames(node, out) {
  if (!node) return;
  if (node.type === 'Identifier') { out.push(node.name); return; }
  if (node.type === 'ObjectPattern') {
    for (const p of node.properties) {
      if (p.type === 'RestElement') patternNames(p.argument, out);
      else patternNames(p.value, out);        // `{ a: b }` 绑的是 b
    }
    return;
  }
  if (node.type === 'ArrayPattern') {
    for (const el of node.elements) patternNames(el, out);
    return;
  }
  if (node.type === 'AssignmentPattern') patternNames(node.left, out);
  if (node.type === 'RestElement') patternNames(node.argument, out);
}

const tdzAt = new Map();          // name -> body index
body.forEach((st, i) => {
  if (st.type === 'VariableDeclaration' && st.kind !== 'var') {
    for (const d of st.declarations) {
      const names = [];
      patternNames(d.id, names);
      for (const n of names) tdzAt.set(n, i);
    }
  } else if (st.type === 'ClassDeclaration' && st.id) {
    tdzAt.set(st.id.name, i);
  }
});

// 2) 收集某个节点里「立即求值」的自由标识符引用。
//    不下钻函数体（箭头/函数表达式都是延迟执行的），但下钻对象/数组/三元等。
function immediateRefs(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => immediateRefs(n, out)); return; }
  switch (node.type) {
    case 'Identifier':
      out.push(node); return;
    case 'MemberExpression':
      immediateRefs(node.object, out); return;   // obj.x —— 只有 obj 是立即求值
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'ObjectMethod':
      return;                                  // 延迟执行，安全
    case 'ObjectProperty':
      // 属性键不是引用（`authRetry: ...` 里的 authRetry 只是键名）；
      // 只有 computed 键（`[expr]: ...`）才真的求值
      if (node.computed) immediateRefs(node.key, out);
      immediateRefs(node.value, out);
      return;
    case 'CallExpression':
      immediateRefs(node.callee, out);
      (node.arguments || []).forEach((a) => immediateRefs(a, out));
      return;
    // import / export 的说明符、函数与类声明本身都不是「读这个变量」
    case 'ImportDeclaration':
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      return;
    default:
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'loc' || k === 'start' || k === 'end' ||
            k === 'leadingComments' || k === 'trailingComments' || k === 'extra') continue;
        const v = node[k];
        if (v && typeof v === 'object') immediateRefs(v, out);
      }
  }
}

let problems = 0;
body.forEach((st, i) => {
  // 只关心「setup 执行到这里就会求值」的语句：
  //   - function 声明 / class 声明 / import：不执行体内代码，跳过
  //   - const/let 声明：只有 init 不是函数表达式时才立即求值
  //   - 其它（表达式语句、if/for 等）：立即求值
  if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration' ||
      st.type === 'ImportDeclaration') return;
  const immediate = [];
  if (st.type === 'VariableDeclaration') {
    for (const d of st.declarations) {
      if (d.init && d.init.type !== 'ArrowFunctionExpression' && d.init.type !== 'FunctionExpression') {
        immediate.push(d.init);
      }
    }
  } else {
    immediate.push(st);
  }

  const hits = new Set();
  for (const n of immediate) {
    const refs = [];
    immediateRefs(n, refs);
    for (const id of refs) {
      const at = tdzAt.get(id.name);
      if (at !== undefined && at > i) {
        hits.add(`${id.name} (声明在第 ${at} 个顶层语句，此处是第 ${i} 个)`);
      }
    }
  }
  if (hits.size) {
    const line = script.slice(0, st.start).split('\n').length;
    console.log(`✗ 源码第 ${line} 行（第 ${i} 个顶层语句）`);
    for (const h of hits) console.log(`      ${h}`);
    problems++;
  }
});

console.log(problems ? `\n${problems} 处 TDZ 隐患` : '\n未发现 TDZ 隐患');
