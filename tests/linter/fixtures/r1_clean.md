# Clean Handoff

Builder → Tester 交棒透過 `shared/tester_input.json`；
Tester → Builder 失敗時回報，重試上限為 3 次（termination condition）。

所有 System Prompt 必須外置於 `prompts/` 目錄。

當第 3 次重試仍失敗，流程終止。
