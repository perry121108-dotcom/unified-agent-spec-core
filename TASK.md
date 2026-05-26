# TASK — Unified Agent Spec Core (Phase 1 Linter)

> 沙盒：`D:/unified-agent-spec-core/`
> 狀態圖例：`[ ]` 待辦 ｜ `[/]` 進行中 ｜ `[x]` 完成（測試＋WORKLOG 雙綠才可勾選）

## Phase 1 — Specification Linter

> Phase 1 結案狀態：**Closed by Tester @ 2026-05-26T05:28:16Z**（四重機器驗證 exit=0 × 4）

- [x] **T1** 建立沙盒結構與治理檔（package.json / tsconfig / eslint / vitest / TASK.md / WORKLOG.md）
- [x] **T2** 將兩個唯讀輸入源安全快照至 `inputs/`，原檔 Mtime 不變
- [x] **T3** 實作 Linter 核心（`src/linter/types.ts`, `loadSpecs.ts`, `index.ts`）
- [x] **T4** 實作規則 R1 — Lifecycle Matrix（狀態轉移死循環）
- [x] **T5** 實作規則 R2 — Prompt Inline Stragglers（提示詞外部化漏勾）
- [x] **T6** 實作規則 R3 — Evidence Contract（機器證據契約）
- [x] **T7** 撰寫 `tests/linter/fixtures/` 人工缺陷樣本與 Vitest 測試（每條規則 ≥3 案例，缺陷攔截率 100%）
- [x] **T8** 實作 `markdownReporter.ts` 並對真實 `inputs/` 產出 `reports/lint-report.md`
- [x] **T9** 在 `src/types/types.ts` 宣告大一統強型別藍圖
- [x] **T10** Builder 自測：`tsc --noEmit` + `vitest run` + `eslint` 全綠
- [x] **T11** 撰寫 `shared/tester_input.json` 並補完 `WORKLOG.md` Builder 自測區塊

## Phase 2 — 雙核心數據實體化（Data-driven Dual Core）

> Phase 2 啟動：2026-05-26T05:32:00Z（Builder 角色）
> 任務範圍：將 Phase 1 通過驗收的型別藍圖實體化為執行期狀態機物件 + JSON Schema 驗證引擎，把 SOP 從文字規範升級為機器可校驗的程式碼契約。

> Phase 2 結案狀態：**Closed by Tester @ 2026-05-26T05:50:12Z**（五重機器驗證 exit=0 × 5；總測試 26 passed）

- [x] **T2.1** 建立 `src/config/agentWorkflowRegistry.ts`，依 `WorkflowStateNode` 宣告 `AI_SOP_STATE_MACHINE`；漏洞回灌：5 角色節點的 `delivery_schema.prompt_externalization` / `execution_evidence_required` 硬鎖為 `true`
- [x] **T2.2** 建立 `src/validator/schemaValidator.ts`，實作 `validateHandoffData(data, role)` 執行期驗證引擎
- [x] **T2.3** 建立 `tests/validator/schemaValidator.test.ts`（正例 / 漏填 Log / 越權交接 / 邊界）≥9 tests 全綠
- [x] **T2.4** Builder Phase 2 自測：`tsc` + `vitest`（≥22 tests）+ `eslint` 三項全綠
- [x] **T2.5** 更新 `shared/tester_input.json` 加入 Phase 2 AC；補完 `WORKLOG.md` Phase 2 Builder 自測區塊

## Phase 3 — CLI 編排引擎與自動化編譯（CLI Hook & Spec Compiler）

> Phase 3 啟動：2026-05-26T05:55:00Z（Builder 角色）
> 任務範圍：將 Markdown 文本動態編譯為機讀數據，並在代理人協作流程關鍵斷點實作 CLI hard-block。

> Phase 3 結案狀態：**Closed by Tester @ 2026-05-26T06:02:52Z**（五重機器驗證 exit=0 × 5；總測試 45 passed；真實 gateHook 子行程實測 PASS+FAIL 雙路徑均符合預期）

- [x] **T3.1** 建立 `src/compiler/specCompiler.ts`，實作 `compileMarkdownToHandoff(taskMd, worklogMd)`，從最新 WORKLOG 區塊提取 `next_role`、`<Execution_Evidence>` 與 `prompts_directory_path` 線索
- [x] **T3.2** 建立 `src/cli/gateHook.ts`，整合 compiler + validator，`success===false` 時 `process.exit(1)`（Hard Block）；通過則更新 `shared/tester_input.json` 並 `process.exit(0)`
- [x] **T3.3** 建立 `tests/compiler/specCompiler.test.ts` + `tests/cli/gateHook.test.ts`（≥9 tests，含 subprocess exit 碼驗證）
- [x] **T3.4** Builder Phase 3 自測：`tsc` + `vitest`（≥35 tests）+ `eslint` 三項全綠
- [x] **T3.5** 更新 `shared/tester_input.json` 至 v0.3.0；補完 `WORKLOG.md` Phase 3 Builder 自測區塊

## Phase 4 — CLI 封裝與全工具鏈自舉集成（CLI Packaging & Self-Bootstrapping）

> Phase 4 啟動：2026-05-26T06:08:00Z（Builder 角色）
> 任務範圍：將核心模組封裝為可執行 CLI 指令，並開發自舉初始化引擎，向任何外部專案一鍵注入「強型別自動化協作治理防線」。

> Phase 4 結案狀態：**Closed by Tester @ 2026-05-26T17:53:00Z**（五重機器驗證 exit=0 × 5；總測試 57 passed；跨目錄黑箱 E2E init/check 雙路徑 exit=0 × 2）

- [x] **T4.1** 配置 `package.json` `bin` 欄位 + 建立 `tsconfig.build.json` 開啟 emit；新增 `npm run build:dist` 編譯腳本
- [x] **T4.2** 建立 `src/bin/agent-core.ts`，支援 `agent-core init` 與 `agent-core check` 兩個子指令
- [x] **T4.3** 建立 `src/cli/bootstrap.ts`，實作 `runBootstrap(targetPath)`：產出 `shared/` + `prompts/` + `TASK.md` + `WORKLOG.md` + `agent-governance.json`
- [x] **T4.4** 建立 `tests/integration/bootstrap.test.ts` ≥10 tests：產物驗證 + runGate 整合 exit 1/0 + subprocess 實測
- [x] **T4.5** Builder Phase 4 自測：`tsc` + `vitest`（≥54 tests）+ `eslint` 全綠；shared/tester_input.json 升版 v0.4.0

## Phase 6 — 自動化管線大一統與 CI 門禁落地（Upstream Orchestration & CI Gate）

> Phase 6 啟動：2026-05-26T18:30:00Z（Builder 角色）
> 任務範圍：將 `agent-core` 的硬性阻斷能力延伸至 GitHub Actions 雲端 CI，並打通 `market-research-ai` 上游調研規格 (`FeatureSpec.json`) 至 TASK.md AC 區塊的自動化編譯橋接器。

> Phase 6 結案狀態：**Closed by Tester @ 2026-05-26T19:30:00Z**（五重機器驗證 exit=0 × 5；總測試 75 passed；跨目錄黑箱 init --spec + check 雙路徑 exit=0；schema validator 對 user-literal mock 之缺漏 feature_id 觸發 exit=1，反例攔截亦驗證通過）

- [x] **T6.1** 在 `src/templates/ci-workflow.tpl.yml` 建立 GitHub Actions CI Gate 範本（checkout / setup-node / `agent-core check`），觸發條件涵蓋 `push: main + feature/*` 與 `pull_request`
- [x] **T6.2** 修改 `src/cli/bootstrap.ts`：`runBootstrap` 自動於目標目錄產出 `.github/workflows/agent-core-gate.yml`，實現出廠即自帶雲端阻斷閘口
- [x] **T6.3** 擴充 `src/compiler/specCompiler.ts` 與 `agent-core init`：支援 `--spec <FeatureSpec.json>` 參數，將上游調研報告的「建議規格」與「風險痛點」陣列動態編譯為 TASK.md 內部 Markdown 驗收標準（AC）區塊
- [x] **T6.4** 新增 `tests/integration/ciWorkflow.test.ts` 與 `tests/compiler/specBridge.test.ts`，新增測試 ≥ 9，累積總測試數 ≥ 66 且全綠
- [x] **T6.5** Builder Phase 6 自測：`tsc` + `vitest`（≥66 tests）+ `eslint` 全綠；更新 `shared/tester_input.json` 升版 v0.5.0；重編 `dist/`

## Phase 8 — Windows 執行期與警告消除優化（Windows Runtime Refinement）

> Phase 8 啟動：2026-05-26T20:55:00Z（Builder 角色）
> 任務範圍：消除在 Windows 環境下執行整合測試與真實 CLI 時產生的 Node.js `DEP0190` 資訊性警告。透過將 `spawnSync(tsx.cmd, ..., { shell: true })` 重構為 `spawnSync(execPath, ['--import', 'tsx', ...], { shell: false })`，移除 shell 依賴、提升執行純淨度與效能。

> Phase 8 結案狀態：**Closed by Tester @ 2026-05-26T21:08:00Z**（五重機器驗證 exit=0 × 5；Test Files 10 passed / Tests 75 passed；`grep -c DEP0190 = 0`；黑箱 dist/bin init+check 雙 stderr 串流為空，無任何 `(node:` 棄用告警）

- [x] **T8.1** 將 Phase 8 章節登入 `TASK.md` 與 `WORKLOG.md`；T8.1–T8.3 全數標記為 `[/]` 進行中
- [x] **T8.2** 重構 `tests/cli/gateHook.test.ts` 與 `tests/integration/bootstrap.test.ts` 內所有 `spawnSync(TSX_BIN, [...], { shell: ... })` 為 `spawnSync(execPath, ['--import', 'tsx', SCRIPT, ...args], { shell: false })`；移除對 `tsx.cmd` / `tsx` 二進位的依賴與 `TSX_BIN` 常數
- [x] **T8.3** Builder 自測：`npm run build` + `npm test` + `npm run lint` 全綠；vitest 輸出**不再包含 DEP0190 informational warning**；累積測試數仍 ≥ 75
