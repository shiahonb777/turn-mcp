const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.resolve(PROJECT_ROOT, 'package.json');
const SUITES = [
  { id: 'prune-hint', file: 'ui-events-entry-prune-hint.test.js' },
  { id: 'events-filters', file: 'ui-events-filter-interactions.test.js' },
  { id: 'history-filters', file: 'ui-history-filter-interactions.test.js' },
  { id: 'pagination', file: 'ui-pagination-interactions.test.js' },
  { id: 'auth-visibility', file: 'ui-events-auth-visibility.test.js' },
];
const SUITES_BY_ID = new Map(SUITES.map((suite) => [suite.id, suite]));
const RUNNER_SCHEMA_VERSION = 1;

function resolveProjectVersion() {
  try {
    const packageRaw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
    const parsed = JSON.parse(packageRaw);
    const version = typeof parsed?.version === 'string' ? parsed.version.trim() : '';
    return version || 'unknown';
  } catch {
    return 'unknown';
  }
}

const PROJECT_VERSION = resolveProjectVersion();

function printHelp() {
  process.stdout.write(
    'Usage: node ./tests/ui-smoke-runner.js [--suite <id[,id...]>] [--fail-fast] [--quiet] [--json] [--output <file>] [--list] [--help]\n' +
      '\n' +
      'Options:\n' +
      '  --suite <id[,id...]>  Run only selected suite id(s), comma-separated allowed\n' +
      '  --fail-fast           Stop on first failed suite\n' +
      '  --quiet               Suppress progress/success logs (non-JSON mode)\n' +
      '  --json                Print machine-readable JSON summary\n' +
      '  --output <file>       Write JSON summary to file (requires --json)\n' +
      '  --list                Print available suite ids and exit\n' +
      '  --help                Show this help and exit\n'
  );
}

function parseArgs(argv) {
  const selectedIds = [];
  let listOnly = false;
  let helpOnly = false;
  let failFast = false;
  let quiet = false;
  let jsonOutput = false;
  let outputPath = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      helpOnly = true;
      continue;
    }
    if (arg === '--list') {
      listOnly = true;
      continue;
    }
    if (arg === '--fail-fast') {
      failFast = true;
      continue;
    }
    if (arg === '--quiet') {
      quiet = true;
      continue;
    }
    if (arg === '--json') {
      jsonOutput = true;
      continue;
    }
    if (arg === '--output') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        return {
          error: '--output requires a value',
          selectedIds: Array.from(new Set(selectedIds)),
          listOnly,
          helpOnly,
          failFast,
          quiet,
          jsonOutput,
          outputPath,
        };
      }
      outputPath = value.trim();
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      outputPath = arg.slice('--output='.length).trim();
      if (!outputPath) {
        return {
          error: '--output requires a value',
          selectedIds: Array.from(new Set(selectedIds)),
          listOnly,
          helpOnly,
          failFast,
          quiet,
          jsonOutput,
          outputPath,
        };
      }
      continue;
    }
    if (arg === '--suite') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        return {
          error: '--suite requires a value',
          selectedIds: Array.from(new Set(selectedIds)),
          listOnly,
          helpOnly,
          failFast,
          quiet,
          jsonOutput,
          outputPath,
        };
      }
      selectedIds.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
      i += 1;
      continue;
    }
    if (arg.startsWith('--suite=')) {
      const raw = arg.slice('--suite='.length);
      selectedIds.push(...raw.split(',').map((item) => item.trim()).filter(Boolean));
      continue;
    }
    return {
      error: `Unknown option: ${arg}`,
      selectedIds: Array.from(new Set(selectedIds)),
      listOnly,
      helpOnly,
      failFast,
      quiet,
      jsonOutput,
      outputPath,
    };
  }
  if (outputPath && !jsonOutput) {
    return {
      error: '--output requires --json',
      selectedIds: Array.from(new Set(selectedIds)),
      listOnly,
      helpOnly,
      failFast,
      quiet,
      jsonOutput,
      outputPath,
    };
  }
  const uniqueSelectedIds = Array.from(new Set(selectedIds));
  return {
    selectedIds: uniqueSelectedIds,
    listOnly,
    helpOnly,
    failFast,
    quiet,
    jsonOutput,
    outputPath,
  };
}

function writeJsonOutputIfNeeded(summary, outputPath) {
  if (!outputPath) {
    return null;
  }
  const resolvedOutputPath = path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath);
  summary.outputFile = resolvedOutputPath;
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return resolvedOutputPath;
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function runSuite(suite) {
  const startedAt = process.hrtime.bigint();
  const targetFile = path.resolve(__dirname, suite.file);
  const result = spawnSync(process.execPath, [targetFile], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const endedAt = process.hrtime.bigint();
  const durationMs = Number(endedAt - startedAt) / 1e6;
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return {
    id: suite.id,
    file: suite.file,
    durationMs,
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    output,
    spawnError: result.error ? String(result.error) : '',
  };
}

function main() {
  const runStartedAtWallMs = Date.now();
  const runStartedAtIso = new Date(runStartedAtWallMs).toISOString();
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    if (parsed.jsonOutput) {
      const finishedAtWallMs = Date.now();
      const invalidArgsSummary = {
        schemaVersion: RUNNER_SCHEMA_VERSION,
        runner: 'ui-smoke-runner',
        projectVersion: PROJECT_VERSION,
        startedAt: runStartedAtIso,
        finishedAt: new Date(finishedAtWallMs).toISOString(),
        durationMs: Number((finishedAtWallMs - runStartedAtWallMs).toFixed(3)),
        runnerExitReason: 'invalid_args',
        error: parsed.error,
        availableSuites: SUITES.map((suite) => ({ id: suite.id, file: suite.file })),
      };
      writeJsonOutputIfNeeded(invalidArgsSummary, parsed.outputPath);
      process.stdout.write(`${JSON.stringify(invalidArgsSummary, null, 2)}\n`);
      process.exit(1);
      return;
    }
    process.stderr.write(`${parsed.error}\n`);
    printHelp();
    process.exit(1);
    return;
  }
  if (parsed.helpOnly) {
    printHelp();
    return;
  }
  if (parsed.listOnly) {
    process.stdout.write('Available UI smoke suites:\n');
    for (const suite of SUITES) {
      process.stdout.write(`- ${suite.id} (${suite.file})\n`);
    }
    return;
  }
  const suitesToRun =
    parsed.selectedIds.length > 0
      ? parsed.selectedIds.map((suiteId) => SUITES_BY_ID.get(suiteId)).filter(Boolean)
      : SUITES;
  if (parsed.selectedIds.length > 0) {
    const missing = parsed.selectedIds.filter((suiteId) => !SUITES_BY_ID.has(suiteId));
    if (missing.length > 0) {
      if (parsed.jsonOutput) {
        const finishedAtWallMs = Date.now();
        const unknownSuiteSummary = {
          schemaVersion: RUNNER_SCHEMA_VERSION,
          runner: 'ui-smoke-runner',
          projectVersion: PROJECT_VERSION,
          startedAt: runStartedAtIso,
          finishedAt: new Date(finishedAtWallMs).toISOString(),
          durationMs: Number((finishedAtWallMs - runStartedAtWallMs).toFixed(3)),
          runnerExitReason: 'invalid_args',
          error: `Unknown suite id(s): ${missing.join(', ')}`,
          selectedSuiteIds: parsed.selectedIds,
          availableSuites: SUITES.map((suite) => ({ id: suite.id, file: suite.file })),
        };
        writeJsonOutputIfNeeded(unknownSuiteSummary, parsed.outputPath);
        process.stdout.write(`${JSON.stringify(unknownSuiteSummary, null, 2)}\n`);
        process.exit(1);
        return;
      }
      process.stderr.write(`Unknown suite id(s): ${missing.join(', ')}\n`);
      process.stderr.write(`Use --list to see valid suite ids.\n`);
      process.exit(1);
      return;
    }
  }
  const allStartedAt = process.hrtime.bigint();
  const results = [];
  if (!parsed.jsonOutput && !parsed.quiet) {
    process.stdout.write(`Running ${suitesToRun.length} UI smoke suites\n`);
  }
  for (const suite of suitesToRun) {
    const result = runSuite(suite);
    results.push(result);
    if (!parsed.jsonOutput && !parsed.quiet) {
      if (result.exitCode === 0) {
        process.stdout.write(`✓ ${result.id} (${formatDuration(result.durationMs)})\n`);
      } else {
        process.stdout.write(`✗ ${result.id} (${formatDuration(result.durationMs)})\n`);
      }
    }
    if (parsed.failFast && result.exitCode !== 0) {
      break;
    }
  }

  const failed = results.filter((result) => result.exitCode !== 0);
  const passed = results.filter((result) => result.exitCode === 0);
  const allDurationMs = Number(process.hrtime.bigint() - allStartedAt) / 1e6;
  const executedSuites = results.length;
  const stoppedEarly = parsed.failFast && executedSuites < suitesToRun.length && failed.length > 0;
  const runnerExitReason =
    failed.length > 0 ? (stoppedEarly ? 'fail_fast_failure' : 'failures_detected') : 'all_passed';
  const finishedAtWallMs = Date.now();
  const finishedAtIso = new Date(finishedAtWallMs).toISOString();

  if (parsed.jsonOutput) {
    const summary = {
      schemaVersion: RUNNER_SCHEMA_VERSION,
      runner: 'ui-smoke-runner',
      projectVersion: PROJECT_VERSION,
      startedAt: runStartedAtIso,
      finishedAt: finishedAtIso,
      totalSuites: suitesToRun.length,
      executedSuites,
      passedSuites: passed.length,
      failedSuites: failed.length,
      failFast: parsed.failFast,
      stoppedEarly,
      selectedSuiteIds: parsed.selectedIds,
      executedSuiteIds: results.map((result) => result.id),
      runnerExitReason,
      durationMs: Number(allDurationMs.toFixed(3)),
      results: results.map((result) => ({
        id: result.id,
        file: result.file,
        durationMs: Number(result.durationMs.toFixed(3)),
        exitCode: result.exitCode,
        output: result.output,
        spawnError: result.spawnError,
      })),
    };
    writeJsonOutputIfNeeded(summary, parsed.outputPath);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (failed.length > 0) {
      process.exit(1);
    }
    return;
  }

  if (failed.length > 0) {
    process.stderr.write(`\nFailed suites: ${failed.length}/${executedSuites}\n`);
    for (const fail of failed) {
      process.stderr.write(`\n--- ${fail.id} (${fail.file}) ---\n`);
      if (fail.spawnError) {
        process.stderr.write(`${fail.spawnError}\n`);
      }
      if (fail.output) {
        process.stderr.write(`${fail.output}\n`);
      } else {
        process.stderr.write('No output captured.\n');
      }
    }
    if (stoppedEarly) {
      process.stderr.write(`\nStopped early due to --fail-fast (${executedSuites}/${suitesToRun.length} executed)\n`);
    }
    process.stderr.write(`\nTotal duration: ${formatDuration(allDurationMs)}\n`);
    process.exit(1);
    return;
  }
  if (!parsed.quiet) {
    process.stdout.write(`All suites passed (${passed.length}/${executedSuites}) in ${formatDuration(allDurationMs)}\n`);
  }
}

main();
