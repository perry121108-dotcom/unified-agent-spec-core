import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpecs } from './loadSpecs.js';
import { lifecycleMatrixRule } from './rules/lifecycleMatrix.js';
import { promptInlineStragglersRule } from './rules/promptInlineStragglers.js';
import { evidenceContractRule } from './rules/evidenceContract.js';
import { renderMarkdownReport } from './reporters/markdownReporter.js';
import type { LintFinding, RuleModule, SpecDocument } from './types.js';

export const RULES: RuleModule[] = [
  lifecycleMatrixRule,
  promptInlineStragglersRule,
  evidenceContractRule,
];

export function runAllRules(docs: SpecDocument[], rules: RuleModule[] = RULES): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const doc of docs) {
    for (const rule of rules) {
      findings.push(...rule.run(doc));
    }
  }
  return findings;
}

export interface ScanResult {
  findings: LintFinding[];
  totalFiles: number;
}

export function scanDirectory(inputDir: string, workspaceRoot: string): ScanResult {
  const docs = loadSpecs(inputDir, { root: workspaceRoot });
  const findings = runAllRules(docs);
  return { findings, totalFiles: docs.length };
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = resolve(here, '..', '..');
  const inputDir = resolve(workspaceRoot, 'inputs');
  const reportPath = resolve(workspaceRoot, 'reports', 'lint-report.md');

  const { findings, totalFiles } = scanDirectory(inputDir, workspaceRoot);
  const md = renderMarkdownReport(findings, {
    generatedAt: new Date().toISOString(),
    inputRoot: 'inputs/',
    totalFiles,
    rules: RULES,
  });

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, md, 'utf8');

  const fails = findings.filter((f) => f.severity === 'FAIL').length;
  const warns = findings.filter((f) => f.severity === 'WARN').length;
  // eslint-disable-next-line no-console
  console.log(`[linter] scanned=${totalFiles} findings=${findings.length} fail=${fails} warn=${warns}`);
  // eslint-disable-next-line no-console
  console.log(`[linter] report=${reportPath}`);
}

const invokedDirect = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirect) {
  main();
}
