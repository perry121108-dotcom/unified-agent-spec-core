import { describe, it, expect } from 'vitest';
import {
  SHADOW_TOKEN_PATTERN,
  computeMutationFingerprint,
  computeShadowToken,
  computeTemporalSalt,
  extractShadowToken,
  getMinuteTimestamp,
  verifyShadowToken,
} from '../../src/validator/shadowWarriorOracle.js';

/* -------------------------------------------------------------------------- */
/* Pure helpers — deterministic primitives                                    */
/* -------------------------------------------------------------------------- */

describe('shadowWarriorOracle — getMinuteTimestamp (UTC minute precision)', () => {
  it('formats YYYY-MM-DD_HH:mm in UTC with leading-zero padding', () => {
    const d = new Date(Date.UTC(2026, 4, 27, 7, 9, 0));
    expect(getMinuteTimestamp(d)).toBe('2026-05-27_07:09');
  });

  it('drops sub-minute precision (seconds and ms do not change the stamp)', () => {
    const a = new Date(Date.UTC(2026, 4, 27, 7, 9, 0));
    const b = new Date(Date.UTC(2026, 4, 27, 7, 9, 59));
    expect(getMinuteTimestamp(a)).toBe(getMinuteTimestamp(b));
  });

  it('rolls over the minute boundary into a distinct stamp', () => {
    const a = new Date(Date.UTC(2026, 4, 27, 7, 9, 59));
    const b = new Date(Date.UTC(2026, 4, 27, 7, 10, 0));
    expect(getMinuteTimestamp(a)).not.toBe(getMinuteTimestamp(b));
  });
});

describe('shadowWarriorOracle — computeTemporalSalt (sha256 over sha::minute)', () => {
  it('produces a 64-char lowercase hex digest', () => {
    const salt = computeTemporalSalt('abc123', '2026-05-27_07:09');
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different SHAs produce different salts under the same minute', () => {
    const s1 = computeTemporalSalt('aaa', '2026-05-27_07:09');
    const s2 = computeTemporalSalt('bbb', '2026-05-27_07:09');
    expect(s1).not.toBe(s2);
  });

  it('same SHA + same minute is reproducible (no entropy)', () => {
    const a = computeTemporalSalt('abc123', '2026-05-27_07:09');
    const b = computeTemporalSalt('abc123', '2026-05-27_07:09');
    expect(a).toBe(b);
  });
});

/* -------------------------------------------------------------------------- */
/* Mutation fingerprint                                                       */
/* -------------------------------------------------------------------------- */

function fakeReader(files: Record<string, string>): (p: string) => string {
  return (absPath: string) => {
    const norm = absPath.replace(/\\/g, '/');
    for (const [key, content] of Object.entries(files)) {
      if (norm.endsWith(key)) return content;
    }
    throw new Error(`fake reader miss: ${norm}`);
  };
}

describe('shadowWarriorOracle — computeMutationFingerprint (sha256 over sorted path::content)', () => {
  it('is order-independent (sorts paths before concatenation)', () => {
    const reader = fakeReader({
      'src/a.ts': 'AAAA',
      'src/b.ts': 'BBBB',
    });
    const f1 = computeMutationFingerprint({
      cwd: '/r',
      paths: ['src/a.ts', 'src/b.ts'],
      reader,
    });
    const f2 = computeMutationFingerprint({
      cwd: '/r',
      paths: ['src/b.ts', 'src/a.ts'],
      reader,
    });
    expect(f1).toBe(f2);
  });

  it('changes when any file content changes (avalanche)', () => {
    const before = computeMutationFingerprint({
      cwd: '/r',
      paths: ['src/x.ts'],
      reader: fakeReader({ 'src/x.ts': 'before' }),
    });
    const after = computeMutationFingerprint({
      cwd: '/r',
      paths: ['src/x.ts'],
      reader: fakeReader({ 'src/x.ts': 'after' }),
    });
    expect(before).not.toBe(after);
  });

  it('marks unreadable files as <unreadable> rather than throwing', () => {
    const reader = (): string => {
      throw new Error('ENOENT');
    };
    expect(() =>
      computeMutationFingerprint({ cwd: '/r', paths: ['src/gone.ts'], reader }),
    ).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* extractShadowToken                                                         */
/* -------------------------------------------------------------------------- */

describe('shadowWarriorOracle — extractShadowToken (evidence parser)', () => {
  it('extracts a 64-char hex token from `shadow_token: <hex>` line', () => {
    const hex = 'a'.repeat(64);
    const body = `noise\nshadow_token: ${hex}\nmore`;
    expect(extractShadowToken(body)).toBe(hex);
  });

  it('returns null when no shadow_token line is present', () => {
    expect(extractShadowToken('no token anywhere')).toBeNull();
  });

  it('matches case-insensitively but lowercases the captured hex', () => {
    const upper = 'B'.repeat(64);
    expect(extractShadowToken(`shadow_token: ${upper}`)).toBe('b'.repeat(64));
  });

  it('SHADOW_TOKEN_PATTERN exports the regex for downstream tooling', () => {
    expect(SHADOW_TOKEN_PATTERN.test('shadow_token: ' + 'c'.repeat(64))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* verifyShadowToken — replay attack matrix                                   */
/* -------------------------------------------------------------------------- */

const FIXED_SHA = 'deadbeefcafebabe0123456789abcdef00112233';
const FIXED_NOW = new Date(Date.UTC(2026, 4, 27, 22, 30, 0));

function makeFingerprint(content: string): string {
  return computeMutationFingerprint({
    cwd: '/r',
    paths: ['src/foo.ts'],
    reader: fakeReader({ 'src/foo.ts': content }),
  });
}

function makeValidToken(content: string, now: Date = FIXED_NOW): string {
  const salt = computeTemporalSalt(FIXED_SHA, getMinuteTimestamp(now));
  return computeShadowToken(salt, makeFingerprint(content));
}

function buildEvidence(token: string | null): string {
  const tokenLine = token === null ? '' : `shadow_token: ${token}\n`;
  return `${tokenLine} ✓ src/foo.test.ts > case 1ms\n Tests  1 passed (1)`;
}

describe('shadowWarriorOracle — verifyShadowToken (Phase 14 replay attack matrix)', () => {
  const FIXTURE_CONTENT = 'export const x = 1;';

  function runVerify(
    overrides: Partial<Parameters<typeof verifyShadowToken>[0]>,
  ): void {
    verifyShadowToken({
      cwd: '/r',
      mutations: ['src/foo.ts'],
      evidenceText: buildEvidence(makeValidToken(FIXTURE_CONTENT)),
      now: FIXED_NOW,
      shaOverride: FIXED_SHA,
      reader: fakeReader({ 'src/foo.ts': FIXTURE_CONTENT }),
      ...overrides,
    });
  }

  it('PASS: token computed for current minute + matching fingerprint → no throw', () => {
    expect(() => runVerify({})).not.toThrow();
  });

  it('PASS: token computed for 1 minute ago still valid within default window', () => {
    const oneMinuteAgo = new Date(FIXED_NOW.getTime() - 60_000);
    const staleByMinute = makeValidToken(FIXTURE_CONTENT, oneMinuteAgo);
    expect(() =>
      runVerify({ evidenceText: buildEvidence(staleByMinute) }),
    ).not.toThrow();
  });

  it('REPLAY-FAIL: token computed 5 minutes ago is outside the 1-minute window', () => {
    const fiveMinAgo = new Date(FIXED_NOW.getTime() - 5 * 60_000);
    const ancient = makeValidToken(FIXTURE_CONTENT, fiveMinAgo);
    expect(() =>
      runVerify({ evidenceText: buildEvidence(ancient) }),
    ).toThrowError(/SHADOW_TOKEN_FORGERY/);
  });

  it('SHA-FAIL: token bound to a different commit SHA → mismatch', () => {
    const otherShaToken = computeShadowToken(
      computeTemporalSalt('different-sha-1234', getMinuteTimestamp(FIXED_NOW)),
      makeFingerprint(FIXTURE_CONTENT),
    );
    expect(() =>
      runVerify({ evidenceText: buildEvidence(otherShaToken) }),
    ).toThrowError(/SHADOW_TOKEN_FORGERY/);
  });

  it('FINGERPRINT-FAIL: code mutated after token generation → mismatch', () => {
    const tokenForOldContent = makeValidToken('export const x = 1;');
    expect(() =>
      runVerify({
        evidenceText: buildEvidence(tokenForOldContent),
        reader: fakeReader({ 'src/foo.ts': 'export const x = 2;' }), // changed AFTER token
      }),
    ).toThrowError(/SHADOW_TOKEN_FORGERY/);
  });

  it('MISSING-FAIL: no shadow_token line at all in evidence → forgery', () => {
    expect(() =>
      runVerify({ evidenceText: buildEvidence(null) }),
    ).toThrowError(/SHADOW_TOKEN_FORGERY.*No `shadow_token/);
  });

  it('FAB-FAIL: arbitrary fake hex matching the format → mismatch', () => {
    const garbage = 'f'.repeat(64);
    expect(() =>
      runVerify({ evidenceText: buildEvidence(garbage) }),
    ).toThrowError(/SHADOW_TOKEN_FORGERY/);
  });

  it('error message embeds the truncated current SHA + window size', () => {
    try {
      runVerify({ evidenceText: buildEvidence('f'.repeat(64)) });
      throw new Error('expected throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('[SHADOW_TOKEN_FORGERY]');
      expect(msg).toContain(FIXED_SHA.slice(0, 12));
    }
  });
});
