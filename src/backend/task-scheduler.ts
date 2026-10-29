import { spawn } from 'node:child_process';
import path from 'node:path';

const TASK_DESCRIPTION = 'Managed by CodeMirror. Do not edit or remove manually.';
const COMMAND_TIMEOUT_MS = 20_000;
const OUTPUT_LIMIT = 64 * 1024;

export interface ScheduledWorkerCommand {
  executable: string;
  args: string[];
}

export interface TaskRegistrationOptions {
  triggerAtLogon?: boolean;
  runImmediately?: boolean;
}

function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function quoteWindowsArgument(value: string): string {
  let quoted = '"';
  let slashes = 0;
  for (const character of value) {
    if (character === '\\') {
      slashes += 1;
    } else if (character === '"') {
      quoted += '\\'.repeat(slashes * 2 + 1) + '"';
      slashes = 0;
    } else {
      quoted += '\\'.repeat(slashes) + character;
      slashes = 0;
    }
  }
  return `${quoted}${'\\'.repeat(slashes * 2)}"`;
}

export function buildTaskSchedulerScript(
  operation: 'exists' | 'running' | 'remove' | 'register',
  taskName: string,
  command?: ScheduledWorkerCommand,
  options: TaskRegistrationOptions = {},
): string {
  const taskNameLiteral = powershellLiteral(taskName);
  const markerLiteral = powershellLiteral(TASK_DESCRIPTION);
  const common = [
    "$ErrorActionPreference = 'Stop'",
    "$service = New-Object -ComObject 'Schedule.Service'",
    '$service.Connect()',
    "$root = $service.GetFolder('\\')",
    `$taskName = ${taskNameLiteral}`,
    `$marker = ${markerLiteral}`,
    '$existing = $null',
    'try { $existing = $root.GetTask($taskName) } catch { if ($_.Exception.HResult -ne -2147024894) { throw } }',
    "if ($existing -and $existing.Definition.RegistrationInfo.Description -ne $marker) { throw 'Refusing to modify a task not owned by CodeMirror.' }",
  ];

  if (operation === 'exists') {
    return [...common, "if ($existing) { 'TASK_EXISTS' } else { 'TASK_MISSING' }"].join('\n');
  }
  if (operation === 'running') {
    return [
      ...common,
      "if ($existing -and ($existing.State -eq 2 -or $existing.State -eq 4)) { 'TASK_RUNNING' } else { 'TASK_NOT_RUNNING' }",
    ].join('\n');
  }
  if (operation === 'remove') {
    return [
      ...common,
      'if ($existing) { $root.DeleteTask($taskName, 0); "TASK_REMOVED" } else { "TASK_MISSING" }',
    ].join('\n');
  }
  if (!command) throw new Error('A worker command is required to register the task.');

  const argumentsText = command.args.map(quoteWindowsArgument).join(' ');
  const registration = [
    ...common,
    '$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name',
    '$definition = $service.NewTask(0)',
    '$definition.RegistrationInfo.Description = $marker',
    '$definition.Settings.Enabled = $true',
    '$definition.Settings.Hidden = $true',
    '$definition.Settings.StartWhenAvailable = $true',
    '$definition.Settings.DisallowStartIfOnBatteries = $false',
    '$definition.Settings.StopIfGoingOnBatteries = $false',
    '$definition.Settings.MultipleInstances = 2',
    "$definition.Settings.ExecutionTimeLimit = 'PT0S'",
    '$definition.Settings.RestartCount = 3',
    "$definition.Settings.RestartInterval = 'PT1M'",
    '$definition.Principal.UserId = $identity',
    '$definition.Principal.LogonType = 3',
    '$definition.Principal.RunLevel = 0',
    '$trigger = $definition.Triggers.Create(9)',
    '$trigger.UserId = $identity',
    '$action = $definition.Actions.Create(0)',
    `$action.Path = ${powershellLiteral(command.executable)}`,
    `$action.Arguments = ${powershellLiteral(argumentsText)}`,
    '$registered = $root.RegisterTaskDefinition($taskName, $definition, 6, $identity, $null, 3, $null)',
  ];
  if (options.triggerAtLogon === false) {
    registration.splice(registration.indexOf('$trigger = $definition.Triggers.Create(9)'), 2);
  }
  if (options.runImmediately) registration.push('$registered.Run($null) | Out-Null');
  registration.push("'TASK_REGISTERED'");
  registration.push(
    "try { " +
      registration.slice(common.length).join('; ') +
      " } catch { " +
      "if (-not $existing) { try { $created = $root.GetTask($taskName); if ($created.Definition.RegistrationInfo.Description -eq $marker) { $root.DeleteTask($taskName, 0) } } catch { Write-Error ('Task rollback failed: ' + $_) } }; " +
      'throw }',
  );
  return [...common, registration.at(-1)!].join('\n');
}

function capture(stream: NodeJS.ReadableStream, getOutput: () => string, setOutput: (value: string) => void): void {
  stream.on('data', (chunk: Buffer | string) => {
    const current = getOutput();
    const next = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    setOutput((current + next).slice(0, OUTPUT_LIMIT));
  });
}

async function runPowerShell(script: string): Promise<string> {
  const executable = path.win32.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    child.stdin.end();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    capture(child.stdout, () => stdout, (value) => { stdout = value; });
    capture(child.stderr, () => stderr, (value) => { stderr = value; });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, COMMAND_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error('Task Scheduler command exceeded its 20-second limit.'));
      } else if (code !== 0) {
        reject(new Error(`Task Scheduler command failed (${code}): ${stderr || stdout}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export class TaskSchedulerService {
  private readonly taskName: string;

  constructor(taskName = 'CodeMirror Background Worker') {
    if (!/^CodeMirror(?:-Test-[A-Za-z0-9-]+| Background Worker)$/.test(taskName)) {
      throw new Error('Task name must use a CodeMirror-owned task name.');
    }
    this.taskName = taskName;
  }

  async isRegistered(): Promise<boolean> {
    return (
      await runPowerShell(buildTaskSchedulerScript('exists', this.taskName))
    ).includes('TASK_EXISTS');
  }

  async isRunning(): Promise<boolean> {
    return (
      await runPowerShell(buildTaskSchedulerScript('running', this.taskName))
    ).includes('TASK_RUNNING');
  }

  async ensureRegistered(
    command: ScheduledWorkerCommand,
    options: TaskRegistrationOptions = {},
  ): Promise<void> {
    await runPowerShell(
      buildTaskSchedulerScript('register', this.taskName, command, {
        triggerAtLogon: true,
        runImmediately: true,
        ...options,
      }),
    );
  }

  async remove(): Promise<void> {
    await runPowerShell(buildTaskSchedulerScript('remove', this.taskName));
  }
}
