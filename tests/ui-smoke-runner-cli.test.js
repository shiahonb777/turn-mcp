const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNNER_PATH = path.resolve(__dirname, './ui-smoke-runner.js');

function runRunner(args) {
  const result = spawnSync(process.execPath, [RUNNER_PATH, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function makeTmpJsonPath(prefix) {
  const token = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return path.join(os.tmpdir(), `${prefix}_${token}.json`);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function testListOptionShowsSuites() {
  const result = runRunner(['--list']);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Available UI smoke suites:/);
  assert.match(result.stdout, /- pagination \(ui-pagination-interactions\.test\.js\)/);
}

function testQuietSuppressesProgressAndSuccessLogs() {
  const result = runRunner(['--suite', 'pagination', '--quiet']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), '');
  assert.equal(result.stderr.trim(), '');
}

function testJsonOutputFileContainsOutputFileField() {
  const outputPath = makeTmpJsonPath('ui_smoke_runner_ok');
  const result = runRunner(['--suite', 'pagination', '--json', '--output', outputPath]);
  assert.equal(result.exitCode, 0);
  const stdoutJson = JSON.parse(result.stdout);
  const fileJson = readJson(outputPath);
  assert.equal(stdoutJson.runnerExitReason, 'all_passed');
  assert.equal(stdoutJson.outputFile, outputPath);
  assert.equal(fileJson.outputFile, outputPath);
  assert.equal(fileJson.executedSuites, 1);
  assert.deepEqual(fileJson.executedSuiteIds, ['pagination']);
}

function testInvalidSuiteJsonOutputFileContainsErrorMetadata() {
  const outputPath = makeTmpJsonPath('ui_smoke_runner_invalid');
  const result = runRunner(['--json', '--suite', 'does-not-exist', '--output', outputPath]);
  assert.equal(result.exitCode, 1);
  const stdoutJson = JSON.parse(result.stdout);
  const fileJson = readJson(outputPath);
  assert.equal(stdoutJson.runnerExitReason, 'invalid_args');
  assert.match(stdoutJson.error, /Unknown suite id\(s\): does-not-exist/);
  assert.equal(stdoutJson.outputFile, outputPath);
  assert.equal(fileJson.runnerExitReason, 'invalid_args');
  assert.equal(fileJson.outputFile, outputPath);
}

function main() {
  testListOptionShowsSuites();
  testQuietSuppressesProgressAndSuccessLogs();
  testJsonOutputFileContainsOutputFileField();
  testInvalidSuiteJsonOutputFileContainsErrorMetadata();
  process.stdout.write('ok - ui smoke runner cli\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
}
