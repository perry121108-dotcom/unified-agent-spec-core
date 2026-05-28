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

## Phase 10 — 本地語意防偽與對抗性子閘口（Semantic & Adversarial Gate）

> Phase 10 啟動：2026-05-26T21:50:00Z（Builder / Security Architect 角色）
> 任務範圍：建立無法被 AI 字串拼接偽造的防禦機制。透過 `<Execution_Evidence>` 內部 AST 模擬解析 + 數學交叉比對（Deterministic Oracle）實施剛性不變式斷言，澈底粉碎 AI 代理人的「偷懶合謀聯盟」。

- [/] **T10.1** 於 `prompts/adversarial_auditor.txt` 建立隔離的對抗性稽核規範（御用反對者人格契約 — Vitest verbose 軌跡 / per-file ↔ aggregate 等式 / 時間與 PID 合理性 / 詞法 AI 拼湊破綻）
- [/] **T10.2** 於 `src/validator/semanticValidator.ts` 實作語意與結構斷言引擎 `validateLogStructure(evidenceText)`：文本抽取（`<Execution_Evidence>` 解包）+ 微觀行掃描（`✓` 符號計數 + `tests/*.test.ts` 路徑抽取）+ 宏觀摘要提取（`Tests N passed (N)`）+ 剛性數學不變式斷言（mismatch ⇒ `[CRITICAL_FORGERY]` 拋出）；CRLF/LF 雙行尾相容
- [/] **T10.3** 將防偽閘口掛載至 `src/cli/gateHook.ts` 之 `runGate`：於 schemaValidator 前強制執行語意追蹤；觸發偽造 ⇒ 高對比度錯誤橫幅 + `process.exit(1)` 硬性阻斷 + 不寫入合規戳記；更新 `tests/cli/gateHook.test.ts` 與 `tests/integration/bootstrap.test.ts` 之 VALID_LOG 為 Phase-10-compliant fixture（per-case ✓ 與 declared total 完全等式）；新增 `tests/validator/semanticValidator.test.ts` 共 14 案（PASS 路徑 3 + FORGED 路徑 5 + 計數/解包工具 5 + 錯誤訊息診斷 1）

## Phase 11 — 多語言日誌解析器與策略模式重構（Multi-language Evidence Parser）

> Phase 11 啟動：2026-05-27T16:30:00Z（Builder / Principal Architect 角色）
> 任務範圍：將 Phase 10 與 Vitest 緊耦合的語意防偽神諭核心 `semanticValidator` 解耦，採用「策略模式 (Strategy Pattern)」建置通用多語言日誌解析工廠。依序實作 Vitest（既有遷移）、Pytest、Jest、Cargo test 四大生態系的特徵偵測（mutex anchor）、每案 tick 計數、宣告總量提取與檔案參照收集；確保 Phase 10 既有 15 案 Vitest 門禁機制 100% 向下相容。

- [/] **T11.1** 在 `src/validator/semanticValidator.ts` 內定義強型別 `TestParserStrategy` 介面（`name` / `detect` / `countScannedTicks` / `extractDeclaredPassed` / `collectTestFileRefs`），將既有 Vitest 邏輯遷移為 `VitestStrategy`，並依序實作 `PytestStrategy` / `JestStrategy` / `CargoStrategy`；建置 mutex 安全的調度工廠 `getStrategy(evidenceText)`，無錨點匹配時拋 `[CRITICAL_FORGERY] Unknown or unsupported test runner log structure.`
- [/] **T11.2** 全面擴充 `tests/validator/semanticValidator.test.ts`：保留 Phase 10 既有 15 案 100% 通過；為 Pytest / Jest / Cargo 三大新策略各追加 PASS 正例 + FORGERY 負例 + EMPTY pure-summary 結構缺陷 + CRLF 雙行尾相容案例（每框架 ≥4 案），並新增 factory mutex 識別斷言 ≥7 案，semanticValidator.test.ts 累積案數從 15 → 37
- [/] **T11.3** Builder Phase 11 自測：`npm run build` + `npm run lint` + `npm test` + `npm run scan` + `npm run build:dist` 五重門禁全綠；總測試案數從 90 → 112（增加 22 案，超過 spec 要求的 12 案下限），達成 spec「應達 100 案以上」目標

## Phase 12: 前置設計錨定門禁 (Pre-flight Architecture Plan Gate)

> Phase 12 啟動：2026-05-27T16:55:00Z（Builder / Principal Architect 角色）
> 任務範圍：把治理閘口從「事後驗證(post-facto evidence audit)」往前推一階,進化為「事前設計錨定(pre-flight architecture plan gate)」。當 Builder 代理人企圖在「未先勾選 ARCH_PLAN 設計意圖」的情況下直接 mutate 源碼,gateHook 必須在語意防偽 oracle 之前先做「雙階段判別」並以 `[ILLEGAL_MUTATION]` 物理阻斷,逼迫代理人先思考、後動工。

- [x] ARCH_PLAN phase-12: implement pre-flight architecture plan gate (archPlanValidator + getWorkspaceMutations + dual-banner) so source mutations without a vetted plan are physically blocked before the Phase 10/11 semantic oracle ever fires; dogfood the gate on its own enabling commit
- [x] T12.1 於 `src/cli/gateHook.ts` 實作雙階段 (Pre-flight / Post-facto) 門禁辨識機制 [Closed by Tester @ 2026-05-27]
- [x] T12.2 新增 `ARCH_PLAN` 剛性不變式，若偵測到源碼變更且計畫未勾選，直接拋出 [ILLEGAL_MUTATION] 物理阻斷 [Closed by Tester @ 2026-05-27]
- [x] T12.3 於 `tests/` 追加 10 案以上前置設計阻斷黑箱負例測試，執行 5-Gate 本地回歸 [Closed by Tester @ 2026-05-27]

## Phase 13: 決定性代碼密度神諭 (Deterministic Code Slop Linter)

> Phase 13 啟動：2026-05-27T20:00:00Z（Builder / Principal Architect 角色）
> 任務範圍：把治理閘口從「設計意圖宣告 (Phase 12)」再下沉一階,進化為「代碼幾何品質硬控管」。對所有 working tree 內變更的 `.ts` / `.js` 實體源碼,用字串/註解逃逸感知的字元級狀態機,逐檔審查 `{}` 嵌套深度 ≤ 4 與單一區塊有效行數 ≤ 60 兩條剛性幾何不變式。並列於 Pre-flight 階段,任一違反 ⇒ 拋 `[CODE_SLOP_DETECTED]` 物理阻斷,不寫合規戳記。

- [x] ARCH_PLAN phase-13: implement deterministic code slop linter — char-level state machine with string/comment escape, depth ≤ 4 + block effective-lines ≤ 60 invariants, hooked into Pre-flight after archPlan; dogfood by keeping all Phase 13 modifications themselves under the geometric limits
- [x] T13.1 於 `src/linter/codeSlopLinter.ts` 實作字串與註釋逃逸感知的大括號深度狀態機 [Closed by Tester @ 2026-05-27]
- [x] T13.2 將 `analyzeCodeSlop` 閘口掛載至 `gateHook.ts` 的 Pre-flight 流水線中，攔截 `[CODE_SLOP_DETECTED]` [Closed by Tester @ 2026-05-27]
- [x] T13.3 於 `tests/` 追加 10 案以上程式碼密度正負例單元測試，執行 5-Gate 本地回歸 [Closed by Tester @ 2026-05-27]

## Phase 14 — Vitest Inline-Test Regex Hot-fix (v0.8.1)

> 啟動：2026-05-27T22:30:00Z（Principal Architect / Release Engineer）
> 任務範圍：Phase 11 `VITEST_FILE_REF` 正則硬鎖 `tests/` 前綴,無法接受 Next.js / Vite 慣用的 `src/**/*.test.ts(x)` inline-test 慣例。本 hot-fix 拓寬正則為通用 `/[A-Za-z0-9_\-./]+\.test\.[jt]sx?/g`,涵蓋任何目錄前綴與 `.test.ts/tsx/js/jsx` 後綴。

- [x] ARCH_PLAN phase-14-hotfix: broaden vitest regex for inline tests [Closed by Tester @ 2026-05-27]
- [x] T14.1 修 `src/validator/semanticValidator.ts` 之 `VITEST_FILE_REF`;新增 ≥1 案 regression test 覆蓋 inline-test 路徑(src/lib + .tsx 變體);累積測試 166 → ≥167;5-Gate 全綠;tag v0.8.1 [Closed by Tester @ 2026-05-27]

## Phase 14 (Complete): 影武者防禦 — 動態時序鹽與源碼指紋鎖定 (Temporal Salting)

> 啟動：2026-05-27T23:00:00Z（Builder / Principal Architect 角色）
> 任務範圍：將四道閘口從「事後內容驗證」延伸至「事後密碼學綁定」。新增 Tier 3.5「影武者神諭」於 Tier 3 (semantic forgery oracle) 與 Tier 4 (schema validator) 之間。攻擊面:AI 代理人重放歷史合規日誌(Replay Attack)。防禦:強制 `<Execution_Evidence>` 內嵌 `shadow_token = sha256( sha256(HEAD_SHA :: minute_stamp) :: file_fingerprint )`,雙重綁定當前 commit + 分鐘級時間 + 源碼指紋,任何漂移即拋 `[SHADOW_TOKEN_FORGERY]`。

- [x] ARCH_PLAN phase-14-complete-shadow: implement shadow-warrior oracle — temporal salt + mutation fingerprint sha256 binding, hooked into runGate as Tier 3.5 between semantic forgery oracle and schema validator; dogfood by keeping all new .ts files under depth ≤ 4 + block ≤ 60
- [x] T14.1 於 `src/validator/shadowWarriorOracle.ts` 實作時序鹽與代碼指紋密碼學雜湊計算引擎 [Closed by Tester @ 2026-05-28]
- [x] T14.2 升級 `semanticValidator.ts` 與 `gateHook.ts`，將影武者驗證掛載為 Post-facto Tier 1.5 門禁，攔截 `[SHADOW_TOKEN_FORGERY]` [Closed by Tester @ 2026-05-28]
- [x] T14.3 於 `tests/` 追加 10 案以上時序重放、指紋篡改等黑箱對抗性測試，執行 5-Gate 本地回歸 [Closed by Tester @ 2026-05-28]

## Phase 16: 生態雙向轉譯器 (Ecosystem Spec Adapter)

> 啟動：2026-05-28T00:00:00Z（Builder / Growth Engineer 角色）
> 任務範圍：建立獨立適配層解決開源 AI agent 生態碎片化痛點。實作中間表示層 (IR, AgentSpecIR) 與雙向轉譯:Import 端解析 Cursor `.cursorrules` / Claude `CLAUDE.md` 軟性行為約束,自動套上 AgentCore 四道剛性鐵閘的最小權限包裹層;Export 端將 AgentCore 安全工作流節點轉譯為 LangGraph 狀態圖 JSON / Semantic Kernel plugin descriptor。零外部 AST 依賴,純靜態 JSON / 文字映射,核心欄位等冪無損。

- [x] ARCH_PLAN phase-16-adapter: build bidirectional ecosystem spec adapter — AgentSpecIR canonical type + cursorrules/CLAUDE.md importers + LangGraph/Semantic Kernel exporters + least-privilege tier wrappers; zero external deps; dogfood by keeping all new .ts files under depth ≤ 4 + block ≤ 60
- [ ] T16.1 於 `src/adapter/specAdapterCore.ts` 實作雙向規格轉譯 IR 核心與 Schema Mapping 引擎 [/]
- [ ] T16.2 實作 Import 功能（解析 `.cursorrules` / `CLAUDE.md`）與 Export 功能（導出 LangGraph 狀態圖 / Semantic Kernel 描述） [/]
- [ ] T16.3 於 `tests/` 追加 15 案以上規格轉譯等冪性與安全邊界包裹單元測試，執行 5-Gate 本地回歸 [/]
