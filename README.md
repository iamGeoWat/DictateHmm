# DictateHmm

> 哼哼输入法 MVP：闭着嘴哼几声（只传声调），结合候选词典，猜出你想说的中文。

这是一个可行性验证级别的 MVP。完整设计思路、各环节技术调研和计划见 [`docs/`](./docs/README.md)。

## 怎么试

### 前置依赖

- Node 20+（Vite 要求）
- Python 3.9+（只用来一次性构建声调索引）
- `pypinyin`（pip install pypinyin）

### 一次性准备

```bash
# 1. 安装前端依赖
npm install

# 2. 下载 jieba 词典到 /tmp/jieba-dict.txt
curl -L -o /tmp/jieba-dict.txt \
  https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt

# 3. 构建声调 → 词候选索引 → public/data/tone-index.json（~7 MB）
python3 scripts/build_tone_index.py
```

### 启动

```bash
npm run dev
```

打开浏览器访问终端输出的地址（默认 http://localhost:5173）。

**Chrome / Edge 桌面版优先，Safari 的 AudioWorklet 有已知坑，没测。**

### 使用方式

1. 点 🎤 开始哼 按钮，浏览器会请求麦克风权限，允许之。
2. 闭嘴哼你的短语，**每个字之间至少停顿 150 ms**（分段靠这个静音）。
3. 点 ⏹ 停止，看候选列表。
4. 下面 Debug 面板有：
   - 检测到的每个字的声调（1/2/3/4/5）+ 置信度
   - pitch 曲线可视化（每段不同颜色）
   - 分段详情、节奏特征、各环节耗时

### 建议试的短语

先试声调差异大的：

- **你好**（3-3）
- **谢谢**（4-4）
- **晚安**（3-1）
- **汉堡包**（4-3-1，就是主要示例）
- **吃饭**（1-4）
- **我爱你**（3-4-3）
- **没关系**（2-1-4）

注意：这个 MVP 没有上下文，纯靠词频排序，你哼的目标词不一定在第 1 位，**看前 10 位里有没有你想说的**。

## 流水线

```
mic → AudioWorklet (16kHz) → pitchy F0 → 能量/F0 分段 → 规则声调分类 → 节奏特征 → beam search 候选
```

详见 `docs/architecture.md` 和各 `docs/stages/*.md`。

## 代码结构

```
src/
├── audio/capture.ts      # getUserMedia + AudioWorklet
├── pitch/extract.ts      # pitchy F0 + 中值滤波 + octave 修正
├── segment/segment.ts    # 能量 + F0 分段
├── tone/classify.ts      # 规则声调（log + z-score + slope/curvature/fMinPos）
├── rhythm/features.ts    # 时长 / 间隔 / 能量
├── candidates/match.ts   # beam search over 声调序列 × 分词
├── pipeline.ts           # 编排
├── types.ts
├── App.tsx / App.css     # UI
└── ui/PitchPlot.tsx      # pitch 曲线可视化
public/
├── audio-worklet.js      # Worklet processor（独立文件，浏览器直接加载）
└── data/tone-index.json  # 声调 → 词候选索引（构建产物）
scripts/
└── build_tone_index.py   # jieba 词典 + pypinyin → 声调索引
```

## 已知局限

- **纯词频排序**，没有 n-gram LM 或 LLM rerank。候选常常被高频 4-4 词淹没（比如"这样"会盖过"谢谢"）。
- **没有上下文**。输入法能用全靠上下文，这版什么都没有。
- **规则声调分类**，二声三声混淆明显。
- **必须停顿**：字间 <150 ms 会被连成一段，丢字。
- **只测过 Chrome 桌面**。

## 下一步

见 [`docs/mvp-plan.md`](./docs/mvp-plan.md)。要让 MVP 达标，大概率需要：

1. 加上下文 + LLM rerank（最大杠杆）。
2. 扩大索引语料，加 n-gram 得分替代纯词频。
3. 声调分类换小 CNN。
