import { acquireProcessLock } from '../src/backend/process-lock.ts';

const [directory, name] = process.argv.slice(2);
if (!directory || !name) throw new Error('Expected lock directory and name.');

const lock = acquireProcessLock(directory, name);
process.stdout.write('LOCKED\n');

process.stdin.setEncoding('utf8');
process.stdin.on('data', (input) => {
  if (!input.includes('release')) return;
  lock.release();
  process.stdout.write('RELEASED\n');
  process.exit(0);
});
process.stdin.resume();
