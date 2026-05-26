import type { AgentRole, WorkflowStateNode } from '../types/types.js';

/**
 * AI_SOP_STATE_MACHINE — Phase 2 數據實體化的全專案 AI 協作狀態機。
 *
 * 規範自我修復（漏洞回灌）：
 *   Phase 1 Linter 報告對 ai_sop_toolkit / Ai-Qa-Skill 範本層共揭露 21 條 R2
 *   命中（缺 `prompts/` 外部化條款）與 12 條 R3 命中（缺機器證據條款）。
 *   本檔將兩條鐵律下沉至程式碼層：每個 delivery_schema 都硬鎖
 *     prompt_externalization      = true
 *     execution_evidence_required = true
 *   範本層即便沒明寫，data layer 仍會拒絕未附 prompts 目錄與真實 Log 的交接。
 *
 * Cross-reference:
 *   R1 Lifecycle Matrix      → allowed_next_stages, termination_condition
 *   R2 Prompt Inline Strag.  → delivery_schema.prompt_externalization
 *   R3 Evidence Contract     → delivery_schema.execution_evidence_required
 */
export const AI_SOP_STATE_MACHINE: Record<AgentRole, WorkflowStateNode> = {
  PM: {
    role: 'PM',
    status: 'in_progress',
    required_context_files: ['TASK.md', 'PROJECT_RULES.md'],
    allowed_next_stages: ['Architect'],
    delivery_schema: {
      prompt_externalization: true,
      execution_evidence_required: true,
      artifact_path: 'shared/pm_out.json',
      contract_version: '1.0.0',
    },
    termination_condition: 'PM 階段於 TASK.md 條目齊備且 AC 寫入機器可驗證指令後結束。',
  },
  Architect: {
    role: 'Architect',
    status: 'in_progress',
    required_context_files: ['TASK.md', 'PROJECT_RULES.md', 'shared/pm_out.json'],
    allowed_next_stages: ['Builder'],
    delivery_schema: {
      prompt_externalization: true,
      execution_evidence_required: true,
      artifact_path: 'shared/architect_out.json',
      contract_version: '1.0.0',
    },
    termination_condition: 'Architect 階段於資料庫 schema、核心函數簽名與 PROJECT_RULES.md 補完後結束。',
  },
  Builder: {
    role: 'Builder',
    status: 'in_progress',
    required_context_files: [
      'TASK.md',
      'PROJECT_RULES.md',
      'CLAUDE.md',
      'shared/architect_out.json',
    ],
    allowed_next_stages: ['Tester'],
    delivery_schema: {
      prompt_externalization: true,
      execution_evidence_required: true,
      artifact_path: 'shared/tester_input.json',
      contract_version: '1.0.0',
    },
    termination_condition:
      'Builder 階段於 tsc/vitest/eslint 三項自測 exit=0、shared/tester_input.json 寫入後結束；嚴禁跨 Session 自評。',
  },
  Tester: {
    role: 'Tester',
    status: 'in_progress',
    required_context_files: ['TASK.md', 'WORKLOG.md', 'shared/tester_input.json'],
    // Tester 完工後依 SOP 進入 Liaison（壓縮歸檔），或於失敗時通知 Builder 修正。
    allowed_next_stages: ['Liaison', 'Builder'],
    delivery_schema: {
      prompt_externalization: true,
      execution_evidence_required: true,
      artifact_path: 'shared/tester_out.json',
      contract_version: '1.0.0',
    },
    termination_condition:
      'Tester 階段於所有 AC 對應指令 exit=0 後結束；任一失敗即回灌 Builder 並記錄 retry_count（上限 3）。',
  },
  Liaison: {
    role: 'Liaison',
    status: 'in_progress',
    required_context_files: ['TASK.md', 'WORKLOG.md', 'shared/tester_out.json'],
    allowed_next_stages: ['PM'],
    delivery_schema: {
      prompt_externalization: true,
      execution_evidence_required: true,
      artifact_path: 'shared/liaison_out.json',
      contract_version: '1.0.0',
    },
    termination_condition:
      'Liaison 階段於上下文壓縮完成、WORKLOG 證據已附、下一階段任務指派完畢後結束。',
  },
};

export function getNode(role: AgentRole): WorkflowStateNode {
  return AI_SOP_STATE_MACHINE[role];
}

export function listRoles(): AgentRole[] {
  return Object.keys(AI_SOP_STATE_MACHINE) as AgentRole[];
}
