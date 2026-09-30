# 荧光笔日历（Calendar Neo）

像拿荧光笔一样在日历上划过想要的日子，不用再点起止日期。做成了 Web Component `<highlighter-calendar>`，任何网页、React / Vue / 原生页面都能直接用。

## 交互

- 左键 / 手指划过：涂色。每个日期背后是 8x8 的小格，被涂到 `threshold`（默认 35）格就算选中。
- 右键划过（或笔的橡皮头）：橡皮擦，同样的逻辑反过来。触屏可以把 `tool` 设成 `erase`。
- 按住不动：墨水在笔尖下洇开变深；停得够久，这一天会被自动"划"一笔选中。按在两个数字中间时，先洇到旁边那天的一半，继续按住才一起选中。扩散只在同一行，不会跑到上下排。
- 来回涂：每一遍叠加变深，到上限就不再变深。
- 单击：直接选中（右键单击取消）。键盘：方向键移动，空格 / 回车切换，PageUp / PageDown 翻月。
- 松手时，没达到阈值的日期上的墨迹会淡出；划得不完整的已选日期会顺着方向自动补完那一笔。

选择结果就是一组日期，连续、组合、错开都可以。

## 多个月：`<highlighter-deck>`

平时只显示当前月，后面叠着今年剩下的月份（1 月下面厚厚一沓，12 月就是最后一张）。在卡片空白处（标题栏、边距）双击，或按住往左 / 往右一划，下个月从卡堆里滑出、上个月从屏幕外飞进来，摊开成「上月 · 本月 · 下月」三张，都能直接涂选。摊开后左右划动按月翻，再双击空白处收回成一叠。三张卡共享同一份选择。

`<highlighter-deck>` 支持和 `<highlighter-calendar>` 一样的属性和事件，另有 `spread` 属性、`spreadchange` 事件、`shift(n)` 方法。

## 运行演示

```bash
npm install
npm run dev      # 打开 http://localhost:5173
npm test         # 选择逻辑的单元测试
npm run build    # 打包到 dist/
```

## 用法

```html
<script type="module" src="highlighter-calendar.js"></script>
<highlighter-calendar month="2026-09" threshold="35" week-start="1"></highlighter-calendar>
<script>
  const cal = document.querySelector('highlighter-calendar');
  cal.addEventListener('change', (e) => console.log(e.detail.value)); // ['2026-09-03', ...]
  cal.value = ['2026-09-10', '2026-09-11'];
</script>
```

| 属性 / 属性名 | 说明 |
| --- | --- |
| `month` | 显示的月份，`YYYY-MM` |
| `threshold` | 64 个小格里涂到多少算选中，默认 35 |
| `week-start` | `1` 周一开始（默认），`0` 周日开始 |
| `locale` | 月份和星期的语言，默认跟随浏览器 |
| `color` | 荧光笔颜色，默认 `#ffd21f` |
| `tool` | 左键 / 触摸的工具：`highlight`（默认）或 `erase` |
| `brush-size` | 笔头大小倍数，0.5–2 |
| `hold-delay` | 停笔多久（毫秒）开始判定长按，默认 320 |
| `value` | 初始选中日期，逗号分隔 |

事件：`input`（划的过程中每选中 / 取消一天）、`change`（松手后有变化时），`detail` 为 `{ value, added, removed }`；`monthchange`（翻月）。方法：`clear()`、`shiftMonth(n)`。

## 代码结构

- `src/engine.ts`：选择逻辑（8x8 小格、阈值、长按扩散、橡皮擦），不依赖 DOM，有单元测试。
- `src/ink.ts`：笔触画面（刷毛、拉丝、叠加变深、淡出、自动补笔动画）。
- `src/calendar.ts`：Web Component，把两者接到指针、键盘和日历网格上。
- `src/deck.ts`：多月份卡片叠放 / 摊开。
- `index.html` + `demo/`：演示页。
