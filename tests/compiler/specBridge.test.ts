import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadFeatureSpec,
  compileFeatureSpecToAcceptanceCriteria,
  FEATURE_SPEC_AC_MARKERS,
  type FeatureSpec,
} from '../../src/compiler/specCompiler.js';
import { runBootstrap } from '../../src/cli/bootstrap.js';

let workspaces: string[] = [];
beforeEach(() => {
  workspaces = [];
});
afterEach(() => {
  for (const ws of workspaces) rmSync(ws, { recursive: true, force: true });
  workspaces = [];
});

function newWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'uasc-spec-'));
  workspaces.push(ws);
  return ws;
}

const SAMPLE_SPEC: FeatureSpec = {
  feature_id: 'F-2026-05-MARKET-INTEL',
  feature_title: '即時市場情報摘要面板',
  spec_version: '1.2.0',
  generated_at: '2026-05-26T10:00:00Z',
  suggested_specifications: [
    '使用者於 3 秒內看到當日 Top-5 競品快訊',
    { id: 'AC-FS-S-OFFLINE', statement: '離線模式快取至少 24 小時的最近一次抓取結果' },
    { id: 'AC-FS-S-TZ', statement: '時區顯示一律以使用者本地時區呈現，後端常駐 UTC' },
  ],
  risk_pain_points: [
    { id: 'AC-FS-R-RATELIMIT', statement: '外部新聞 API rate-limit 觸發時必須降級', severity: 'high' },
    '舊版瀏覽器無 WebSocket — 必須提供 polling fallback',
  ],
};

describe('Phase 6 — loadFeatureSpec validation', () => {
  it('parses a well-formed FeatureSpec JSON file', () => {
    const ws = newWorkspace();
    const p = join(ws, 'FeatureSpec.json');
    writeFileSync(p, JSON.stringify(SAMPLE_SPEC), 'utf8');
    const loaded = loadFeatureSpec(p);
    expect(loaded.feature_id).toBe(SAMPLE_SPEC.feature_id);
    expect(loaded.suggested_specifications).toHaveLength(3);
    expect(loaded.risk_pain_points).toHaveLength(2);
  });

  it('throws when the file does not exist', () => {
    const ws = newWorkspace();
    expect(() => loadFeatureSpec(join(ws, 'missing.json'))).toThrowError(/cannot read FeatureSpec/);
  });

  it('throws when the JSON is malformed', () => {
    const ws = newWorkspace();
    const p = join(ws, 'broken.json');
    writeFileSync(p, '{ not valid json', 'utf8');
    expect(() => loadFeatureSpec(p)).toThrowError(/not valid JSON/);
  });

  it('throws when feature_id is missing', () => {
    const ws = newWorkspace();
    const p = join(ws, 'no-id.json');
    writeFileSync(p, JSON.stringify({ suggested_specifications: ['x'] }), 'utf8');
    expect(() => loadFeatureSpec(p)).toThrowError(/feature_id/);
  });

  it('throws when neither suggested_specifications nor risk_pain_points is populated', () => {
    const ws = newWorkspace();
    const p = join(ws, 'empty.json');
    writeFileSync(p, JSON.stringify({ feature_id: 'F-EMPTY' }), 'utf8');
    expect(() => loadFeatureSpec(p)).toThrowError(/at least one non-empty array/);
  });
});

describe('Phase 6 — compileFeatureSpecToAcceptanceCriteria', () => {
  it('emits a marker-fenced block containing every suggested specification statement verbatim', () => {
    const ac = compileFeatureSpecToAcceptanceCriteria(SAMPLE_SPEC);
    expect(ac.startsWith(FEATURE_SPEC_AC_MARKERS.begin)).toBe(true);
    expect(ac.endsWith(FEATURE_SPEC_AC_MARKERS.end)).toBe(true);
    expect(ac).toContain('使用者於 3 秒內看到當日 Top-5 競品快訊');
    expect(ac).toContain('離線模式快取至少 24 小時的最近一次抓取結果');
    expect(ac).toContain('時區顯示一律以使用者本地時區呈現，後端常駐 UTC');
  });

  it('emits every risk/pain point with explicit severity surfaced when present', () => {
    const ac = compileFeatureSpecToAcceptanceCriteria(SAMPLE_SPEC);
    expect(ac).toContain('外部新聞 API rate-limit 觸發時必須降級');
    expect(ac).toContain('severity: high');
    expect(ac).toContain('舊版瀏覽器無 WebSocket — 必須提供 polling fallback');
  });

  it('uses provided AC ids when supplied, otherwise auto-numbers AC-FS-S<N> / AC-FS-R<N>', () => {
    const ac = compileFeatureSpecToAcceptanceCriteria(SAMPLE_SPEC);
    // first suggested item was a plain string → must auto-number as AC-FS-S1
    expect(ac).toMatch(/\*\*AC-FS-S1\*\*/);
    // explicit ids preserved
    expect(ac).toMatch(/\*\*AC-FS-S-OFFLINE\*\*/);
    expect(ac).toMatch(/\*\*AC-FS-R-RATELIMIT\*\*/);
    // second risk item was a plain string → AC-FS-R2 (since first risk had explicit id)
    expect(ac).toMatch(/\*\*AC-FS-R2\*\*/);
  });
});

describe('Phase 6 — runBootstrap --spec integration (FeatureSpec → TASK.md AC injection)', () => {
  it('injects the AC block into a freshly-scaffolded TASK.md and reports the file as augmented', () => {
    const ws = newWorkspace();
    const specPath = join(ws, 'FeatureSpec.json');
    writeFileSync(specPath, JSON.stringify(SAMPLE_SPEC), 'utf8');
    const summary = runBootstrap(ws, { featureSpecPath: specPath });
    const task = readFileSync(join(ws, 'TASK.md'), 'utf8');
    expect(task).toContain(FEATURE_SPEC_AC_MARKERS.begin);
    expect(task).toContain(FEATURE_SPEC_AC_MARKERS.end);
    expect(task).toContain('Upstream Acceptance Criteria');
    expect(task).toContain('AC-FS-S-OFFLINE');
    expect(task).toContain('AC-FS-R-RATELIMIT');
    expect(summary.augmented).toContain('TASK.md');
  });

  it('100% of upstream AC statements end up in TASK.md (hard contract)', () => {
    const ws = newWorkspace();
    const specPath = join(ws, 'FeatureSpec.json');
    writeFileSync(specPath, JSON.stringify(SAMPLE_SPEC), 'utf8');
    runBootstrap(ws, { featureSpecPath: specPath });
    const task = readFileSync(join(ws, 'TASK.md'), 'utf8');
    const everyStatement = [
      '使用者於 3 秒內看到當日 Top-5 競品快訊',
      '離線模式快取至少 24 小時的最近一次抓取結果',
      '時區顯示一律以使用者本地時區呈現，後端常駐 UTC',
      '外部新聞 API rate-limit 觸發時必須降級',
      '舊版瀏覽器無 WebSocket — 必須提供 polling fallback',
    ];
    for (const s of everyStatement) {
      expect(task, `TASK.md is missing AC statement: ${s}`).toContain(s);
    }
  });

  it('is idempotent — running --spec a second time does not duplicate the AC block', () => {
    const ws = newWorkspace();
    const specPath = join(ws, 'FeatureSpec.json');
    writeFileSync(specPath, JSON.stringify(SAMPLE_SPEC), 'utf8');
    runBootstrap(ws, { featureSpecPath: specPath });
    const first = readFileSync(join(ws, 'TASK.md'), 'utf8');
    const second = runBootstrap(ws, { featureSpecPath: specPath });
    const after = readFileSync(join(ws, 'TASK.md'), 'utf8');
    expect(after).toBe(first);
    expect(second.augmented).not.toContain('TASK.md');
    // exactly one occurrence of the begin marker
    const matches = after.match(new RegExp(FEATURE_SPEC_AC_MARKERS.begin, 'g'));
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('still passes the throw path when --spec points at a malformed file (no TASK.md mutation)', () => {
    const ws = newWorkspace();
    const specPath = join(ws, 'broken.json');
    writeFileSync(specPath, '{ ', 'utf8');
    expect(() => runBootstrap(ws, { featureSpecPath: specPath })).toThrowError(/not valid JSON/);
    // TASK.md may or may not have been created before the throw depending on order,
    // but if created it must NOT contain the AC marker.
    const taskPath = join(ws, 'TASK.md');
    if (existsSync(taskPath)) {
      expect(readFileSync(taskPath, 'utf8')).not.toContain(FEATURE_SPEC_AC_MARKERS.begin);
    }
  });
});
