import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

// Exercise shelved provider adapters explicitly, without changing production policy.
export function allowPaidAdaptersForTest(t: TestContext): void {
  const directory = mkdtempSync(path.join(tmpdir(), 'paid-ai-adapter-test-'));
  const file = path.join(directory, 'policy.json');
  writeFileSync(file, JSON.stringify({ paidRoutesEnabled: true }));
  const previous = process.env.AI_COST_POLICY_PATH;
  process.env.AI_COST_POLICY_PATH = file;
  t.after(() => {
    if (previous === undefined) delete process.env.AI_COST_POLICY_PATH;
    else process.env.AI_COST_POLICY_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  });
}
