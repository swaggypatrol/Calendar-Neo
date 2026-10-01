# Calendar Neo（荧光笔日历）

[English](README.md) · **简体中文**

> 日期不是点出来的，是涂出来的。拿荧光笔在想要的日子上划过去，剩下的交给它。爱乱涂的、爱画锯齿的、拿着笔停住不动也说不出为什么的，都能选到自己的日子。

Calendar Neo 是一组不依赖任何框架的 Web Component。不用再点起止日期，而是像在纸质日历上一样，拿荧光笔在想要的日子上划过去。鼠标、手指、手写笔都能用，放进原生页面、React、Vue 或任何能渲染 DOM 的地方都行。

选择结果就是一组日期，连续、组合、错开都一样。

## 组件

| 元素 | 是什么 |
| --- | --- |
| `<highlighter-calendar>` | 一个可以涂选的月份，其它组件都建立在它上面。 |
| `<highlighter-book>` | 一本打开的纸质日历：左右两页各一个月，纸张双面印刷，软软地卷起来翻页。 |
| `<highlighter-picker>` | 预订网站用的日期框：一个窄框，点开后长成纸质日历，并写出你选了哪些日子。 |
| `<highlighter-deck>` | 早期的多月布局：一叠可以左右划的月份卡片。 |

## 怎么涂

- **左键 / 手指划过**：涂色。每个日期背后是 8×8 的小格，涂到 `threshold`（默认 64 格里的 35 格）就算选中。
- **右键划过**（或笔的橡皮头）：橡皮擦，同样的逻辑反过来。触屏可以设 `tool="erase"`。
- **按住不动**：墨水在笔尖下洇开变深，停得够久这一天就会被一笔划过选中。按在两个数字中间时，先洇到旁边那天的一半，继续按住才一起选中。扩散只在同一行，不会跑到上下排。
- **来回涂**：颜色一层层叠深，到上限为止。
- **随便涂**：画的时候可以涂在格子里任何地方；松笔后笔画会自然地挪进以日期数字为中心、高度 0.618 格的窄带，底下再垫一笔补齐空隙，看起来整齐统一。
- 松笔时，没涂够的日期上的墨迹会淡出；涂得不完整的已选日期会顺着方向自动补完那一笔。
- **单击**：直接选中（右键单击取消）。键盘：方向键移动，空格 / 回车切换，PageUp / PageDown 翻月。

## 纸质日历：`<highlighter-book>`

- 任何时候都摊开两个月，一页一个月。每张纸正反两面都印着月份，就像真书。
- **翻页**：在日期格子以外的空白处按住拖，或者在触控板上两指左右滑。往左拖，右页从页角掀起来、跟着手指翻过去；往右拖是翻回来。拖过三成左右或轻轻一甩就翻过去，否则落回原处。连着快速划会一页接一页地翻。右页右下角平时就微微掀起、轻轻起伏，那就是这张纸本身，点它或拉它都会接着这个卷角把整页翻过去。
- **书签**代替发光：选过日子的月份，那张纸在书口伸出一枚书签，按月份排在不同高度，上面写着那个月选了几天（1 到 5+）。翻过去的在左边，还没翻到的在右边。点书签直接翻到那个月，书签会滑进页面，变成从页顶垂下来的丝带。
- 已经过去的月份印着一圈暗角。
- 所有变化都是动画，没有任何瞬移。

## 预订日期框：`<highlighter-picker>`

平时是一个窄框，写着今天的日期。点一下，它平滑地长成纸质日历，右页页角翘起来一下，提示可以翻页。点外面或按 Esc 收回。

选好以后框里写出日期段，比如「11月14日 – 12月11日」。选了好几段时，框会变成一个小滚轮，可以左右拖、滚动或点箭头来转；点一下就打开到那一段所在的月份。

## 只选未来的预约

给客户预约时加上 `min="today"`（还可以加 `max`）。范围外的日子灰掉，笔刷划过去不留墨；从上周一路划到下周也没关系，过去的那几天会自动跳过。书也不会翻到整月都不可选的月份。

```html
<highlighter-picker min="today" max="+90"></highlighter-picker>
```

`min` / `max` 可以写 `today`、`tomorrow`、`+N`（N 天后）或 `YYYY-MM-DD`。相对写法每次重画时按当天日期重新换算。范围外的已选日期会被去掉，并触发 `change`。

## 用法

```html
<script type="module" src="highlighter-calendar.js"></script>

<highlighter-picker week-start="1" color="#ffd21f"></highlighter-picker>

<script>
  const picker = document.querySelector('highlighter-picker');
  picker.addEventListener('change', (e) => console.log(e.detail.value)); // ['2026-09-03', ...]
  picker.value = ['2026-09-10', '2026-09-11'];
</script>
```

所有组件共用这些属性：

| 属性 | 说明 |
| --- | --- |
| `month` | 显示的月份，`YYYY-MM`（书是左页的月份） |
| `threshold` | 64 个小格里涂到多少算选中，默认 35 |
| `week-start` | `1` 周一开始（默认），`0` 周日开始 |
| `locale` | 月份和星期的语言，默认跟随浏览器 |
| `color` | 荧光笔颜色，默认 `#ffd21f` |
| `tool` | 左键 / 触摸的工具：`highlight`（默认）或 `erase` |
| `brush-size` | 笔头大小倍数，0.5–2 |
| `hold-delay` | 停笔多久（毫秒）开始算长按，默认 320 |
| `value` | 初始选中的日期，逗号分隔 |
| `min`、`max` | 可选范围（见上文） |
| `theme` | `light` 或 `dark`，强制日间或夜间；不写就跟随系统 |

事件：`input`（涂的过程中每选中 / 取消一天触发一次）、`change`（松笔后有变化时），`detail` 都是 `{ value, added, removed }`；`monthchange`（看到的月份变了）。

方法：`clear()`；书有 `next()` / `prev()` / `show(month)`；日期框有 `open()` / `close()`。

## 运行演示

```bash
npm install
npm run dev          # 打开 http://localhost:5173（右上角的太阳 / 月亮按钮切换日夜间）
npm run dev:booking  # 只选未来的演示：http://localhost:5173/booking.html
npm test             # 选择逻辑的单元测试
npm run build        # 打包到 dist/
```

## 代码结构

- `src/engine.ts`：选择逻辑（8×8 小格、阈值、长按扩散、橡皮擦），不依赖 DOM，有单元测试。
- `src/ink.ts`：荧光笔的样子（刷毛、拉丝、叠加变深、淡出、松笔落带、自动补笔）。
- `src/calendar.ts`：`<highlighter-calendar>` 元素，把前两者接到指针、键盘和月份网格上。
- `src/book.ts`：纸质日历（两页、卷页翻页、书签）。
- `src/picker.ts`：预订日期框（窄框、展开动画、日期段滚轮）。
- `src/deck.ts`：卡片叠放的布局。
- `src/range.ts`：`min` / `max` 的处理。
- `index.html` + `demo/`：演示页；`booking.html` + `demo/booking.ts`：只选未来的演示页。

## 许可证

[Mozilla Public License 2.0](LICENSE)。
