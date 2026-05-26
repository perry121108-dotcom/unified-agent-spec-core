#!/usr/bin/env node
import { runBootstrap } from '../cli/bootstrap.js';
import { runGate } from '../cli/gateHook.js';

const USAGE = `Usage:
  agent-core init [--spec <path/to/FeatureSpec.json>]
      Bootstrap governance scaffolding (TASK.md, WORKLOG.md, shared/, prompts/,
      agent-governance.json, .github/workflows/agent-core-gate.yml) into CWD.
      With --spec, the upstream market-research FeatureSpec is compiled into
      a Markdown AC block and injected into TASK.md.

  agent-core check
      Compile WORKLOG.md and enforce strong-typed handoff invariants
      (exit 1 on any failure).
`;

interface ParsedInit {
  ok: true;
  specPath: string | undefined;
}
interface ParseError {
  ok: false;
  message: string;
}

function parseInitArgs(rest: string[]): ParsedInit | ParseError {
  let specPath: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--spec') {
      const next = rest[i + 1];
      if (!next) return { ok: false, message: '--spec flag requires a path argument' };
      specPath = next;
      i++;
      continue;
    }
    if (a !== undefined && a.startsWith('--spec=')) {
      specPath = a.slice('--spec='.length);
      continue;
    }
    return { ok: false, message: `unexpected argument: ${a ?? ''}` };
  }
  return { ok: true, specPath };
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case 'init': {
      const parsed = parseInitArgs(args.slice(1));
      if (!parsed.ok) {
        // eslint-disable-next-line no-console
        console.error(`[agent-core] ${parsed.message}\n\n${USAGE}`);
        return 2;
      }
      const target = process.cwd();
      let summary;
      try {
        summary = runBootstrap(
          target,
          parsed.specPath ? { featureSpecPath: parsed.specPath } : {},
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[agent-core][FAIL] ${(e as Error).message}`);
        return 1;
      }
      // eslint-disable-next-line no-console
      console.log(`[agent-core] init complete @ ${target}`);
      for (const f of summary.created) {
        // eslint-disable-next-line no-console
        console.log(`  + ${f}`);
      }
      for (const f of summary.augmented) {
        // eslint-disable-next-line no-console
        console.log(`  ~ ${f}  (FeatureSpec AC injected)`);
      }
      return 0;
    }

    case 'check': {
      const res = runGate({ workspaceRoot: process.cwd() });
      if (res.exitCode === 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[agent-core] check PASS role=${res.role} next=${res.payload.next_role ?? '(none)'}`,
        );
      } else {
        for (const err of res.errors) {
          // eslint-disable-next-line no-console
          console.error(`[agent-core][FAIL] ${err}`);
        }
      }
      return res.exitCode;
    }

    case undefined:
    case '-h':
    case '--help':
    case 'help': {
      // eslint-disable-next-line no-console
      console.log(USAGE);
      return cmd === undefined ? 2 : 0;
    }

    default: {
      // eslint-disable-next-line no-console
      console.error(`[agent-core] unknown subcommand: ${cmd}\n\n${USAGE}`);
      return 2;
    }
  }
}

process.exit(main(process.argv));
