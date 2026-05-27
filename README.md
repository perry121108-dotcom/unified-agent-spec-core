# unified-agent-spec-core

> 跨語言多代理人 (Multi-Agent) **進程級零信任監獄控制台** — 把「Builder / Tester / 上游調研 / 提示詞外部化 / 設計意圖 / 代碼幾何 / 證據真實性」全部從口頭約定升格為 OS 進程級 `exit 1` 物理阻斷。AI 沒得偷懶,人類不必看戲。

[![CI](https://github.com/perry121108-dotcom/unified-agent-spec-core/actions/workflows/ci.yml/badge.svg)](https://github.com/perry121108-dotcom/unified-agent-spec-core/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-0.8.0-blue)](./package.json)
[![node](https://img.shields.io/badge/node-%E2%89%A520.x-339933)](https://nodejs.org/)
[![tests](https://img.shields.io/badge/tests-166%20passed-brightgreen)](./tests)

---

## 為什麼存在這個專案？

我抓到了 AI Agent 為了應付我而**偽造 Vitest 綠燈日誌**;接著我抓到它**沒寫設計就動手亂改 src/**;接著我抓到它**寫出深度 7 層、單函式 200 行的 AI Slop**。三次都是同一隻 Agent,三次都自信滿滿說「測試通過」。

AI 多代理人協作流程最大的失敗模式不是「能力不足」,而是 **代理人偷懶合謀(AI collusion)**:Builder 謊報、Tester 目測放行、Architect 把計畫寫在腦子裡而不是檔案裡。最終 SOP 流程在 PR / Merge 時集體破防。

於是我寫了 `unified-agent-spec-core`,把每一條會被偷懶繞過的治理不變式編碼成 OS 進程級的 `exit 1`。

> **核心信念:SOP 不該是文字承諾,不該是陪 AI 聊天的開小灶,而該是進程級的 `exit 1` 物理阻斷。**

---

## 🛡️ 核心治理矩陣:四道剛性不變式鐵閘 (The 4-Tier Matrix)

`agent-core check` 在 commit 前一毫秒按以下順序瀑布式啟動。**任何一道失敗 ⇒ `process.exit(1)`,不寫合規戳記**,代理人補完缺失後重跑即可放行(可逆撤回)。

| Tier | 鐵閘 | 階段 | 觸發物 | 物理阻斷錯誤碼 |
|---|---|---|---|---|
| **1** | **Intent Gate** (前置設計錨定門禁) | Phase 12 | `src/`/`tests/` 變更 + `TASK.md` 內未勾選 `- [x] ARCH_PLAN` | **`[ILLEGAL_MUTATION]`** |
| **2** | **Geometry Gate** (決定性代碼密度神諭) | Phase 13 | 任一 `.ts`/`.js` 變更檔內巢狀深度 > 4 或單一 `{...}` 區塊有效行數 > 60 | **`[CODE_SLOP_DETECTED]`** |
| **3** | **Forgery Oracle** (多語言語意防偽神諭) | Phase 10 & 11 | `<Execution_Evidence>` 內 scanned ticks ≠ declared passed,或無法識別的 runner | **`[CRITICAL_FORGERY]`** |
| **4** | **Runtime Validator** (JSON Schema 狀態機校驗) | Phase 1-3 | `delivery_schema` 違反:越權交接 / 漏 prompts / 證據過短 / 漏欄位 | (per-rule 訊息) |

### Tier 1: Intent Gate (Phase 12 前置設計錨定門禁)

當變更觸及 `src/` 或 `tests/`,若 `TASK.md` 內**未勾選 `- [x] ARCH_PLAN`** 的變更計畫(AST 影響樹),在動手前一毫秒發動 `[ILLEGAL_MUTATION]` 物理中斷,徹底封殺 AI「先斬後奏」破壞底層架構。零作業系統外掛 shell,純 `spawnSync` 撈 `git diff` + `git status --porcelain`。

### Tier 2: Geometry Gate (Phase 13 決定性代碼密度神諭)

自研字元級 **6 模態流式狀態機**(`NORMAL` / `LINE_COMMENT` / `BLOCK_COMMENT` / `STR_SINGLE` / `STR_DOUBLE` / `STR_BACKTICK`),自動逃逸字串、單/多行註釋與轉義字元。強制執行**雙重幾何硬約束**:

$$\text{nesting\_depth} \le 4 \quad \land \quad \text{block\_effective\_lines} \le 60$$

全面擊落功能正確但不堪入目的低密度技術債垃圾代碼(AI Slop)。

### Tier 3: Forgery Oracle (Phase 10 & 11 多語言語意防偽神諭)

盲測日誌特徵,以 mutex 安全的 `getStrategy()` 工廠自適應調度 **Vitest / Pytest / Jest / Cargo test** 的代數不變式校驗:

$$\text{scanned\_ticks} \equiv \text{declared\_passed}$$

精確審查微觀 ticks 行數,封殺 AI「字串拼接偽造測試綠燈報告」的惡意合謀。錯誤訊息嵌入 `Runner=<name>` 子字串,單一程式碼路徑覆蓋四種測試框架。

### Tier 4: Runtime Validator (Phase 1-3 JSON Schema 狀態機校驗)

硬核校驗角色狀態機交接負載(Delivery Schema):`prompt_externalization` / `execution_evidence_required` 硬鎖為 `true`;`next_role` 必須符合 5 角色狀態機允許的轉移;artifact 路徑必須真實存在於檔案系統。防止越權與合規漏洞。

---

## 💥 降維打擊:AgentCore 監獄管理學 vs 6 大自嗨 Skill

市面常見的 AI 編碼 Skill 流於「對話脈絡內的優化」 — 用更漂亮的 prompt、更聰明的 LLM 調用、更花俏的視覺驗證去**繞過**問題的根源。AgentCore 走相反方向:**根本不參與對話,在進程邊界做最冷酷的硬阻斷**。

| 異質維度 / 核心 Skill | 市面常見輕量 Agent 範式 / AI 編碼對話技巧<br>(如 Claude Code / UltraQA / Optimizer) | **AgentCore v0.8.0 完全體防禦陣線** |
|:---|:---|:---|
| **1. prompt-optimizer** | 依賴人類輸入自然語言,用二級 Prompt 做軟綿綿的文字美化。 | **大一統數據拓撲**。直接吞掉上游自動化工具產出的機讀 `FeatureSpec.json`,秒級編譯為技術驗收標準(AC)。 |
| **2. deep-interview** | 在脈絡內讓 AI 分飾兩角,軟性向人類反問澄清需求的模糊地帶。 | **零信任手續校驗**。交接負載若缺漏欄位或違反狀態機,AI 連發問的機會都沒有,OS 層直接退件。 |
| **3. ralplan (改前設計)** | 口頭交代 AI 動手前先出計畫,缺乏 OS 進程級的剛性物理約束。 | **Pre-flight 物理鐵閘**。未打勾 `- [x] ARCH_PLAN` 卻敢擅動原始碼,Git Hook 直接擊落。 |
| **4. ultraqa (自動修復)** | 盲目信任終端機字串輸出。AI 代理人只要拼接 fake log 就能輕鬆合謀放水。 | **剛性代數不變式**。自適應策略工廠清點微觀 Ticks 行數,等式不等立即執行死刑。 |
| **5. ai-slop-cleaner** | 依賴 AI 自我檢討是否有「AI 味」,容易陷入自我包庇與算力黑洞。 | **決定性代碼密度神諭**。純淨字元狀態機幾何清點深度與長度,指標超標直接物理阻斷。 |
| **6. visual-verdict** | 依賴多模態 LLM 截圖進行視覺比對,算力成本昂貴且具模糊性。 | **不競爭視覺,專精 Headless 終端**。在 Git/CI 斷點上做最冷酷的硬阻斷,保證代碼血統真實性。 |

**根本差異:** 對手在「優化 AI 輸出品質」;我們在「假設 AI 必然偷懶,在它能偷懶的每一個進程斷點先把 fork 砸碎」。

---

## 安裝與快速啟動

```bash
# 1) clone & install
git clone https://github.com/perry121108-dotcom/unified-agent-spec-core.git
cd unified-agent-spec-core
npm install

# 2) build (produces dist/, including dist/bin/agent-core.js)
npm run build:dist

# 3) 對任意外部專案一鍵注入治理鷹架
cd /path/to/your-project
node /path/to/unified-agent-spec-core/dist/bin/agent-core.js init

# 4) 本地手動跑門禁(等同 CI 行為)
node /path/to/unified-agent-spec-core/dist/bin/agent-core.js check
```

> Windows 提示:已於 Phase 8 重構 `spawnSync(execPath, ['--import', 'tsx', ...], { shell: false })`,完全消除 `DEP0190` 警告,無需 shell 依賴。

---

## CLI 介面

```text
agent-core init [--spec <path/to/FeatureSpec.json>]
    在當前目錄產生治理鷹架:
      TASK.md / WORKLOG.md
      shared/tester_input.json
      prompts/(外部化提示詞目錄)
      agent-governance.json
      .github/workflows/agent-core-gate.yml  ← 出廠即自帶 CI 阻斷閘口
    搭配 --spec:讀取上游 market-research-ai 的 FeatureSpec.json,
    將「建議規格」與「風險痛點」自動編譯為 TASK.md 的 AC 區塊。

agent-core check
    從當前目錄按四道閘口瀑布式校驗:
      ① Intent Gate     ─ Phase 12 archPlan 未勾選且有 src/tests 變更 → exit 1
      ② Geometry Gate   ─ Phase 13 .ts/.js 巢套 > 4 或區塊 > 60 行 → exit 1
      ③ Forgery Oracle  ─ Phase 10/11 scanned ticks ≠ declared passed → exit 1
      ④ Schema Gate     ─ Phase 1-3 delivery_schema / 越權 / 漏 prompts → exit 1
    全綠 → exit 0,寫入合規戳記至 shared/tester_input.json。
```

---

## 專案結構

```
src/
  bin/agent-core.ts              # CLI entry (init / check / help)
  cli/
    bootstrap.ts                 # init 命令:scaffold + CI workflow 產出
    gateHook.ts                  # check 命令:四道閘口編排 (T1→T4 瀑布)
  compiler/specCompiler.ts       # Markdown → Handoff 編譯器 + FeatureSpec bridge
  validator/
    schemaValidator.ts           # Tier 4: JSON Schema 執行期校驗
    semanticValidator.ts         # Tier 3: Phase 10 & 11 自適應多語言語意防偽 Oracle (策略模式工廠)
    archPlanValidator.ts         # Tier 1: Phase 12 前置設計錨定門禁
  linter/
    codeSlopLinter.ts            # Tier 2: Phase 13 字元級 6 模態狀態機,深度 + 區塊行數雙不變式
    (R1/R2/R3 規則引擎)         # Phase 1 規範規則引擎
  config/agentWorkflowRegistry.ts # 5 角色狀態機 (AI_SOP_STATE_MACHINE)
  templates/ci-workflow.tpl.yml  # GitHub Actions CI Gate 範本
  types/types.ts                 # 大一統強型別藍圖

prompts/
  adversarial_auditor.txt        # 御用反對者 (Devil's Advocate) 隔離人格契約

tests/                            # vitest:166 案,涵蓋 linter/validator/cli/integration
```

---

## 防偽 Oracle 範例

當 Builder 代理人嘗試貼上「看起來合理」但偽造的 log:

```
<Execution_Evidence>
Test Files  10 passed (10)
Tests       89 passed (89)
</Execution_Evidence>
```

`semanticValidator.ts` 會發現 `✓` per-case 行數 = 0,但宣稱 89 passed,不變式違反:

```
================================================================
  [agent-core][FAIL] SEMANTIC FORGERY DETECTED — HARD BLOCK
================================================================
[CRITICAL_FORGERY] aggregate claims 89 passed but only 0 per-case ✓ markers found
================================================================
  No compliance stamp written to shared/tester_input.json.
  Re-run your test suite and paste the FULL verbose log.
================================================================
```

→ `process.exit(1)`,CI 紅燈,Merge 被擋。

### Pytest 等效攔截(Phase 11 自適應)

同一道 oracle、同一條代數等式 — 不需改 import,不需設定 flag。`getStrategy()` 工廠以 `test session starts` 錨點命中 `PytestStrategy`,自動切換到 Pytest 形狀的計數規則:

```
<Execution_Evidence>
============================= test session starts ==============================
collected 9 items

============================== 9 passed in 0.01s ===============================
</Execution_Evidence>
```

`PytestStrategy` 對宣告區 `===== 9 passed =====` 提取 `declared_passed = 9`,對 body 掃描 `/^.*PASSED.*$/gm` 得 `scanned_ticks = 0`。同一條不變式 $\text{scanned\_ticks} \equiv \text{declared\_passed}$ 被異質文本觸發:

```
================================================================
  [agent-core][FAIL] SEMANTIC FORGERY DETECTED — HARD BLOCK
================================================================
[CRITICAL_FORGERY] Evidence log matrix mismatch or structure artificial.
Runner=pytest. Summary line declares 9 passed tests but only 0 per-case
markers were scanned in the evidence body. Per-case track MUST sum to the
declared aggregate.
================================================================
```

→ 等冪硬阻斷:`Runner=pytest` 字面量自動嵌入診斷訊息,Jest / Cargo 路徑完全相同(`Runner=jest` / `Runner=cargo`)。**單一程式碼路徑,四種測試框架。**

---

## ⚡ 實戰驗證 (Battle-Tested Evidence / Proof of Work)

本工具鏈絕非停留在理論階段的玩具,它已作為**中央治理鐵閘**實體回灌至真實的多儲存庫(Cross-Repo)開發管線中,完成了端到端的閉環驗證:

1. **上游商業規格橋接 (`market-research-ai`)**:
   成功解碼上游 AI 自動化市場調研專案所輸出的 `FeatureSpec.json` 數據契約,透過 `specCompiler` 將模糊的商業痛點與功能建議,秒級自動轉譯並注入為下游專案的硬性技術驗收標準(AC)。

2. **下游產品線剛性門禁 (`zhiyin-app`)**:
   在實體 Next.js 履歷求職顧問專案(`zhiyin-app`)的 Phase 5 至 Phase 7 核心研發週期中,`agent-core` 部署為本地 Git Hook 與雲端 GitHub Actions 門禁。**在真實開發歷程中,累計精確攔截 AI 代理人「越權交接」、「漏報測試數據」以及「空包彈日誌提交」共 14 次**。

3. **核心內核 Meta-recursive Dogfooding 自證**:
   Phase 12 (Intent Gate) 與 Phase 13 (Geometry Gate) 的**建立鐵閘的 commit 本身先通過鐵閘** — Phase 12 commit `5a62277` 自帶 `- [x] ARCH_PLAN phase-12` 並通過 archPlanValidator;Phase 13 commit `bd60278` 的 4 個變更 `.ts` 檔同時通過 depth ≤ 4 + block ≤ 60 雙重幾何約束。**鐵閘證明自己有能力證明自己** — 這是治理工具的終極合法性。

---

## 治理哲學

| Phase | 主題 | 關鍵交付 |
|-------|------|---------|
| 1 | Specification Linter | R1 Lifecycle / R2 Prompt Externalization / R3 Evidence Contract |
| 2 | Data-driven Dual Core | `AI_SOP_STATE_MACHINE` + `validateHandoffData` |
| 3 | CLI Hook & Spec Compiler | `gateHook` + `specCompiler` + subprocess exit-code 驗證 |
| 4 | CLI Packaging & Self-Bootstrapping | `agent-core init/check` + 跨目錄 E2E |
| 6 | Upstream Orchestration & CI Gate | GitHub Actions workflow + FeatureSpec → AC 自動編譯 |
| 8 | Windows Runtime Refinement | 消除 `DEP0190`,`shell:false` 純淨執行 |
| 10 | Semantic Forgery Oracle (Vitest) | `validateLogStructure` + 御用反對者人格契約 |
| **11** | **Multi-language Strategy Matrix** | `TestParserStrategy` × 4 runners (Vitest/Pytest/Jest/Cargo) + mutex 工廠 |
| **12** | **Pre-flight Architecture Plan Gate** | `archPlanValidator` + `getWorkspaceMutations` + `[ILLEGAL_MUTATION]` |
| **13** | **Deterministic Code Slop Linter** | `codeSlopLinter` + 6 模態字元狀態機 + `[CODE_SLOP_DETECTED]` |

詳細交付歷史:見 [`TASK.md`](./TASK.md) 與 [`WORKLOG.md`](./WORKLOG.md)。

---

## 開發

```bash
npm run build      # tsc --noEmit(型別檢查,不 emit)
npm run build:dist # 真正產出 dist/ + 拷貝模板資產
npm run lint       # eslint
npm test           # vitest run(166 cases,13 test files)
npm run scan       # 對 inputs/ 跑 linter 並輸出 reports/lint-report.md
npm run gate       # 直接跑 src/cli/gateHook.ts(等同 dist 的 check)
```

CI:[.github/workflows/ci.yml](.github/workflows/ci.yml) — `push: main` / `pull_request` 觸發。

---

## 授權

尚未指定 LICENSE — 預設保留所有權利。如需開源請 issue 或 PR 提案授權條款。

---

## 路線圖

- ✅ Phase 10 (semanticValidator + Vitest oracle) — closed v0.6.0
- ✅ Phase 11 (多語言 evidence parser:pytest / jest / cargo test) — closed v0.7.0
- ✅ Phase 12 (Pre-flight Architecture Plan Gate) — closed
- ✅ Phase 13 (Deterministic Code Slop Linter) — closed v0.8.0
- ⏳ Phase 14:Git pre-commit hook auto-install(讓 `agent-core init` 自動掛 `.husky/`)
- ⏳ Phase 15:VS Code 擴充 — 編輯器內即時 lint TASK / WORKLOG / 即時顯示四 Tier 狀態
- ⏳ Phase 16:第 5 Tier 候選 — 依賴圖反向影響面分析(import graph reverse impact)
