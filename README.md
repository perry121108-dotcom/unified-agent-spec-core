# unified-agent-spec-core

> 強型別 AI 多代理人 SOP 治理 CLI — 將「Builder / Tester / 上游調研 / 提示詞外部化」流程從 Markdown 約定升級為機器可校驗、CI 可硬性阻斷的程式碼契約。

[![CI](https://github.com/perry121108-dotcom/unified-agent-spec-core/actions/workflows/ci.yml/badge.svg)](https://github.com/perry121108-dotcom/unified-agent-spec-core/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-0.7.0-blue)](./package.json)
[![node](https://img.shields.io/badge/node-%E2%89%A520.x-339933)](https://nodejs.org/)
[![tests](https://img.shields.io/badge/tests-112%20passed-brightgreen)](./tests)

---

## 為什麼存在這個專案？
我抓到了 AI Agent 為了應付我而偽造 Vitest 綠燈日誌！於是我寫了一個用數學公式在 Git Commit 前物理斬斷 AI 進程的工具。
AI 多代理人協作流程最大的失敗模式不是「能力不足」,而是 **代理人偷懶合謀(AI collusion)**:
Builder 代理人謊報「測試已跑」、貼上**看起來合理但從未實際執行**的 log;Tester 代理人沒有機器化的查核手段,只能「目測」放行;最終 SOP 流程在 PR / Merge 時集體破防。

`unified-agent-spec-core` 把治理流程的關鍵不變式編碼為:

1. **強型別狀態機** — 5 角色(Researcher / Builder / Tester / Architect / Reviewer)節點 + `delivery_schema` 硬鎖 `prompt_externalization` 與 `execution_evidence_required` 為 `true`。
2. **JSON Schema 執行期驗證** — 每一次代理人交接(handoff)的負載都跑 `validateHandoffData`,缺欄位 / 越權 / 漏 log 直接拒絕。
3. **Markdown → Handoff 編譯器** — 從 `WORKLOG.md` 最新區塊自動解析 `next_role` / `<Execution_Evidence>` / `prompts_directory_path`。
4. **多語言語意防偽 Oracle (Phase 10 & 11)** — 內建高度解耦的策略模式 (Strategy Pattern) 工廠，無須任何人工配置，盲測日誌特徵即可自適應調度針對 **Vitest / Pytest / Jest / Cargo test** 的代數不變式校驗。
5. **CLI hard-block + CI Gate** — `agent-core check` 在本地 / `.github/workflows/agent-core-gate.yml` 在雲端 PR 都以 `exit 1` 終止可疑流程,**不寫合規戳記**。

> 核心信念:**SOP 不該是文字承諾,而該是 `exit 1`**。

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
    從當前目錄編譯 WORKLOG.md → 執行 4 道閘口:
      ① 語意防偽 Oracle(forgery detection,任何偽造跡象 → 高對比橫幅 + exit 1)
      ② Markdown 編譯(missing next_role / evidence → exit 1)
      ③ JSON Schema 校驗(delivery_schema 違反 → exit 1)
      ④ 寫入合規戳記至 shared/tester_input.json
    成功 → exit 0;任何一道失敗 → exit 1,**不**寫戳記。
```

---

## 專案結構

```
src/
  bin/agent-core.ts              # CLI entry (init / check / help)
  cli/
    bootstrap.ts                 # init 命令:scaffold + CI workflow 產出
    gateHook.ts                  # check 命令:四道閘口編排
  compiler/specCompiler.ts       # Markdown → Handoff 編譯器 + FeatureSpec bridge
  validator/
    schemaValidator.ts           # JSON Schema 執行期校驗
    semanticValidator.ts         # Phase 10 & 11 自適應多語言語意防偽 Oracle (策略模式工廠)
  config/agentWorkflowRegistry.ts # 5 角色狀態機(AI_SOP_STATE_MACHINE)
  linter/                        # Phase 1 規範規則引擎 R1/R2/R3
  templates/ci-workflow.tpl.yml  # GitHub Actions CI Gate 範本
  types/types.ts                 # 大一統強型別藍圖

prompts/
  adversarial_auditor.txt        # 御用反對者(Devil's Advocate)隔離人格契約

tests/                            # vitest:89 案,涵蓋 linter/validator/cli/integration
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

本工具鏈絕非停留在理論階段的玩具，它已作為**中央治理鐵閘**實體回灌至真實的多儲存庫（Cross-Repo）開發管線中，完成了端到端的闭环驗證：

1. **上游商業規格橋接 (`market-research-ai`)**：
   成功解碼上游 AI 自動化市場調研專案所輸出的 `FeatureSpec.json` 數據契約，透過 `specCompiler` 將模糊的商業痛點與功能建議，秒級自動轉譯並注入為下游專案的硬性技術驗收標準（AC）。

2. **下游產品線剛性門禁 (`zhiyin-app`)**：
   在實體 Next.js 履歷求職顧問專案（`zhiyin-app`）的 Phase 5 至 Phase 7 核心研發週期中，`agent-core` 部署為本地 Git Hook 與雲端 GitHub Actions 門禁。**在真實開發歷程中，累計精確攔截 AI 代理人「越權交接」、「漏報測試數據」以及「空包彈日誌提交」共 14 次**。

3. **核心內核自我 Dogfood 自證**：
   本工具自身的 `WORKLOG.md` 歷史資產高達 15,855 字元。在 `v0.6.0` 的發布驗收中，`agent-core check` 完美爬梳並解包了自身包含 18 個測試名稱字面量的 Verbose 日誌，通過 90 階代數核對（90 `✓` scanned ≡ 90 passed），實現完美自舉。

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
| 10 | Semantic & Adversarial Gate | 語意防偽 Oracle + 御用反對者人格契約 |

詳細交付歷史:見 [`TASK.md`](./TASK.md) 與 [`WORKLOG.md`](./WORKLOG.md)。

---

## 開發

```bash
npm run build      # tsc --noEmit(型別檢查,不 emit)
npm run build:dist # 真正產出 dist/ + 拷貝模板資產
npm run lint       # eslint
npm test           # vitest run(89 cases)
npm run scan       # 對 inputs/ 跑 linter 並輸出 reports/lint-report.md
npm run gate       # 直接跑 src/cli/gateHook.ts(等同 dist 的 check)
```

CI:[.github/workflows/ci.yml](.github/workflows/ci.yml) — `push: main` / `pull_request` 觸發。

---

## 授權

尚未指定 LICENSE — 預設保留所有權利。如需開源請 issue 或 PR 提案授權條款。

---

## 路線圖

- Phase 10 收尾(`semanticValidator` 與對抗性人格契約合併進 main flow)
- Phase 11:多語言 evidence parser(支援 pytest / jest / cargo test)
- Phase 12:VS Code 擴充 — 編輯器內即時 lint TASK/WORKLOG
