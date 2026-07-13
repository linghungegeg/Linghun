import { adaptShellCommandForPlatform } from './packages/tools/dist/index.js';

console.log('Testing PowerShell compound commands...\n');

const tests = [
  {
    name: 'PowerShell cmdlets with semicolon',
    command: "Write-Output 'hello'; Write-Output 'world'",
    expected: 'powershell-adapted'
  },
  {
    name: 'Ordinary commands with semicolon',
    command: 'node --version; npm --version',
    expected: 'native'
  },
  {
    name: 'Multiple ordinary commands',
    command: 'git --version; node --version; npm --version',
    expected: 'native'
  },
  {
    name: 'Explicit PowerShell',
    command: "powershell.exe -NoProfile -Command 'Get-Date; Write-Output test'",
    expected: 'native'
  },
  {
    name: 'Remote shell with pipe (should block)',
    command: 'adb shell ls | grep .apk',
    expected: 'blocked'
  },
  {
    name: 'File write with heredoc (should block)',
    command: 'cat <<EOF > file.txt\ncontent\nEOF',
    expected: 'blocked'
  },
  {
    name: 'POSIX export (should block)',
    command: 'export VAR=value; echo $VAR',
    expected: 'blocked'
  },
  {
    name: 'Command substitution (should block)',
    command: 'echo $(date); echo done',
    expected: 'blocked'
  },
  {
    name: 'Simple command without semicolon',
    command: 'node --version',
    expected: 'native'
  }
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    const result = adaptShellCommandForPlatform(test.command, 'win32');
    const success = result.adapter === test.expected;

    if (success) {
      console.log(`✓ ${test.name}`);
      console.log(`  adapter: ${result.adapter}`);
      passed++;
    } else {
      console.log(`✗ ${test.name}`);
      console.log(`  expected: ${test.expected}, got: ${result.adapter}`);
      console.log(`  command: ${result.command.slice(0, 80)}...`);
      failed++;
    }
  } catch (error) {
    console.log(`✗ ${test.name} - ERROR: ${error.message}`);
    failed++;
  }
  console.log();
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
