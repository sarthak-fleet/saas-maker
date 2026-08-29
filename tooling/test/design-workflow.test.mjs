import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { validateDesignReview } from '../lib/design-workflow.mjs';

const root = resolve(import.meta.dirname, '..');
const policy = JSON.parse(readFileSync(resolve(root, 'config/design-workflow.json'), 'utf8'));
const template = JSON.parse(readFileSync(resolve(root, 'templates/design-review.json'), 'utf8'));

function completePersuadeReceipt() {
  const receipt = structuredClone(template);
  receipt.project = 'example';
  receipt.target = 'landing page';
  receipt.surfaceMode = 'persuade';
  receipt.direction.contract = {
    purpose: 'Explain the product clearly to the intended visitor.',
    purposeSource: 'SaaS Maker purpose contract plus PRODUCT.md',
    canonicalPurpose: 'Example helps a specific user complete a specific job.',
    purposeAlignment: 'match',
    driftNote: '',
    audience: 'A specific intended user.',
    job: 'Understand the product and choose the honest next action.',
    thesis: 'A product-specific visual thesis.',
    system: 'A role-based visual system.',
    signature: 'A memorable product-specific element.',
    risk: 'One deliberate and bounded visual risk.',
  };
  receipt.direction.library.sources.push('https://tailwindcss.com/plus/ui-blocks/marketing/sections/footers');
  receipt.direction.library.runtime = 'markup-only';
  receipt.evidence.projectCheck = { command: 'pnpm test', status: 'pass' };
  receipt.evidence.critique.score = 32;
  receipt.evidence.audit.score = 16;
  receipt.evidence.comprehension = {
    status: 'pass',
    reviewer: 'independent reviewer',
    answers: {
      product: 'Example product',
      audience: 'A specific intended user',
      value: 'A specific useful outcome',
      mechanism: 'A distinct product mechanism',
      proof: 'A working product artifact',
      nextAction: 'Open the product',
    },
    purposeScore: {
      product: 25,
      audience: 15,
      value: 15,
      mechanism: 15,
      proof: 15,
      nextAction: 15,
      total: 100,
    },
    mismatches: [],
  };
  return receipt;
}

test('a persuade receipt passes when canonical purpose and fresh-visitor answers agree', () => {
  assert.doesNotThrow(() =>
    validateDesignReview(completePersuadeReceipt(), policy, {
      projectRoot: root,
      pathExists: () => true,
    }),
  );
});

test('a visually passing persuade receipt fails when copy contradicts product purpose', () => {
  const receipt = completePersuadeReceipt();
  receipt.evidence.comprehension.mismatches.push(
    'The hero promises a public signup while the canonical next action says retained history only.',
  );
  assert.throws(
    () => validateDesignReview(receipt, policy, { projectRoot: root, pathExists: () => true }),
    /cannot pass with product-purpose contradictions/,
  );
});

test('a newer repository contract requires an explicit drift note', () => {
  const receipt = completePersuadeReceipt();
  receipt.direction.contract.purposeAlignment = 'repository-override';
  assert.throws(
    () => validateDesignReview(receipt, policy, { projectRoot: root, pathExists: () => true }),
    /repository purpose overrides require a drift note/,
  );
});

test('high visual scores cannot compensate for a weak purpose score', () => {
  const receipt = completePersuadeReceipt();
  receipt.evidence.critique.score = 40;
  receipt.evidence.audit.score = 20;
  receipt.evidence.comprehension.purposeScore.product = 5;
  receipt.evidence.comprehension.purposeScore.total = 80;
  assert.throws(
    () => validateDesignReview(receipt, policy, { projectRoot: root, pathExists: () => true }),
    /visual scores cannot compensate/,
  );
});

test('a Tailwind Plus review records the exact upstream component source', () => {
  const receipt = completePersuadeReceipt();
  receipt.direction.library.sources = [];
  assert.throws(
    () => validateDesignReview(receipt, policy, { projectRoot: root, pathExists: () => true }),
    /upstream library adoption requires at least one exact component or block URL/,
  );

  receipt.direction.library.sources.push('https://tailwindcss.com/plus/ui-blocks/marketing/sections/footers');
  receipt.direction.library.runtime = 'markup-only';
  assert.doesNotThrow(() =>
    validateDesignReview(receipt, policy, { projectRoot: root, pathExists: () => true }),
  );
});

test('a custom replacement requires explicit owner authorization and an upstream gap', () => {
  const receipt = completePersuadeReceipt();
  receipt.direction.library.primary = 'custom';
  receipt.direction.library.sources = [];
  receipt.direction.library.customReplacement.used = true;
  receipt.direction.library.customReplacement.authorization = 'agent-selected';
  receipt.direction.library.customReplacement.reason = 'No upstream component supports the interaction.';

  assert.throws(
    () => validateDesignReview(receipt, policy, { projectRoot: root, pathExists: () => true }),
    /explicit owner-requested authorization/,
  );
});
