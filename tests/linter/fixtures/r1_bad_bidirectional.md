# Bad Bidirectional Loop

This fixture both names a contract file and triggers Pattern B:

- Builder → Tester（產出 `shared/tester_input.json`）
- Tester → Builder（回報缺陷）

雙方相互投遞工件，本文件未陳述任何停止規則。
