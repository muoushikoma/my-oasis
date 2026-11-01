# 《无尽之路》素材生成器

`stories/endless-road/assets/` 里的所有图片都由这里的脚本生成：精灵是逐像素手绘的字符网格（`pix.js`），背景是带抖动的像素分层（`bg.js`）。改完重新生成即可，不需要任何绘图软件。

需要 Node.js 和 Playwright（Chromium）。在本目录运行：

```bash
node pixgen.mjs out/pix 6     # 精灵 → out/pix/*.png（自动光影 + 选择性描边），out/pix/_preview.png 是放大预览
node bggen.mjs out/bg         # 背景 4 层 × 6 个地区 → out/bg/*.png，out/bg/_preview.png 是合成预览
```

然后把 `out/pix/*.png`（除了 `_preview.png` 和 `meta.json`）复制到 `stories/endless-road/assets/sprites/`，把 `out/bg/bg_<地区>_<层>.png` 改名为 `<地区>_<层>.png` 复制到 `assets/bg/`，最后运行 `node cover.mjs` 重新生成封面和远景图。

## 怎么加一个新精灵

1. 在 `pix.js` 的 `SPRITES` 里加一项：每个字符是 `PAL` 里的一种颜色，`.` 是透明；敌人朝左画，主角朝右画；不用画描边（生成时自动加）。
2. 重新生成，把 PNG 放进 `assets/sprites/`。
3. 在 `story.yaml` 的 `assets` 里登记，在 `scripts/scene.js` 的 `SPR` 里写上帧的宽高（看 `out/pix/meta.json`）。
4. 想让 AI 能选它：把名字加进 `scripts/road.js` 的 `FOE_SPRITES` 或 `KIND_SPRITES`，以及 `story.yaml` 里 `road_event` 的 `sprite` 枚举和提示词。
