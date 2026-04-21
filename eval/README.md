# DictateHmm Eval

工具路径：仓库根跑 `npm run dev`，浏览器打开 `http://localhost:5173/eval`。

## 目录

- `datasets/phrases.txt` —— 脚本，人维护。一行一条中文，`#` 开头是注释。
- `datasets/phrases.json` —— 编译产物。`npm run build:phrases` 生成。commit 进仓库。
- `datasets/phrases_freeform.txt` —— 可选。自由短语清单（Phase 1 手动维护）。
- `datasets/labels.json` —— 录制时自动追加。一条 phrase 可多次录；评测只用最新那次。
- `datasets/recordings/*.wav` —— 录音，commit 进仓库（Phase 1 规模 < 20 MB）。
- `results/*.json` —— 每次跑评测落盘，**不 commit**（`.gitignore` 已忽略）。
- `.venv/` —— pypinyin 的 Python 虚拟环境，**不 commit**。

## 第一次设置（仅一次）

Homebrew Python 在 PEP 668 下不允许 `pip install --global`，所以 pypinyin 走一个
项目本地的 venv：

```bash
python3 -m venv eval/.venv
eval/.venv/bin/pip install pypinyin
```

`npm run build:phrases` 会用 `eval/.venv/bin/python` 跑，不依赖系统 Python。

## 工作流三步走

### 1. 编脚本

编辑 `datasets/phrases.txt`，加想要的短语。然后：

```bash
npm run build:phrases
```

把 `phrases.json` 也 commit 掉（声调口径用 pypinyin TONE3，和
`scripts/build_tone_index.py` 一致）。

### 2. 录音

```bash
npm run dev
```

浏览器打开 `http://localhost:5173/eval/record`。左栏选一条，「🎤 录」→ 试听 →
「💾 保存」。脚本按"已录次数升序"排序，所以录得最少的一直排最上面；顺着录就行。

录到 Phase 1 目标 20–30 条就可以先停，跑一次评测看效果。

### 3. 跑评测

```bash
npm run dev   # 如果没在跑
```

浏览器打开 `http://localhost:5173/eval/run`。按「▶ Run Eval」。几秒到几十秒后看
表格。结果 JSON 自动落到 `results/<iso-ts>.json`。

## 指标口径（写死别改）

- **Top-K 命中**：`expected.text` 必须**整句**出现在 `candidates[0..K)` 的 text 字段里。
- **声调准确率（按位置）**：只在段数对得上的样本上算。段数错误率**单独报**。
- **声调混淆矩阵**：键 `"期望→实际"`，只在段数对齐部分累加。
- **按字数拆**：按 `expected.text.length` 分桶，每桶报 Top-5。
- **延迟**：`sum(pipeline.timings)`，p50/p95/mean。

这些在 `src/eval/metrics.ts` 有测试锁住，别随意改，否则跨时间不可比。

## 已知限制 / 坑

- **浏览器**：Chrome/Edge 桌面是目标。Safari 初步测过一次，capture 出来的音频
  RMS < -60 dBFS，低于 segmentation 的 -45 dB 阈值导致零段数。原因未查（可能
  AGC 没生效 / AudioWorklet 实现差异），**用 Chrome 录制**。如果必须支持 Safari，
  需要把 `SILENCE_RMS_DB` 改成相对阈值。
- **端点路径**：`/__eval/*` 端点只在 `npm run dev` 下存在（production build 绕过）。
  如果你跑 `npm run preview` 或部署，录制和评测页会全部 404，因为 Vite dev
  插件不参与生产 build。
- **phrases_freeform.txt 自动追加未实现**：Phase 1 想加自由条目就手动写进
  `eval/datasets/phrases_freeform.txt` 再跑 `npm run build:phrases`。

## 文件命名约定

录音文件：`<id>_<YYYYMMDD>_<HHMM>_<NN>.wav`，`NN` 是今天该 id 的第几次录制。
服务端会校验 `/^[a-z0-9_]+\.wav$/i`，别加别的字符。

结果文件：`<YYYY-MM-DDTHH-MM-SS>.json`，由服务端生成。
