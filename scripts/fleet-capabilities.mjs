#!/usr/bin/env node

import {
  CAPABILITY_TYPES,
  ERROR_CODES,
  buildCatalog,
  diagnoseCatalog,
  evaluateExecutionProfile,
  errorEnvelope,
  generateContext,
  getCapability,
  listCapabilities,
  searchCapabilities,
  successEnvelope,
} from '../lib/capability-catalog.mjs';

const COMMANDS = Object.freeze([
  'list',
  'search',
  'get',
  'execution',
  'context',
  'doctor',
]);

const HELP = `Fleet capability catalog

Usage:
  fleet-capabilities.mjs list [--type <type>] [--json] [--dense]
  fleet-capabilities.mjs search <query> [--type <type>] [--json] [--dense]
  fleet-capabilities.mjs get <capability-id> [--json] [--dense]
  fleet-capabilities.mjs execution <skill-id> --runtime <intelligence:reasoning> [--json] [--dense]
  fleet-capabilities.mjs context [query] [--type <type>] [--json] [--dense]
  fleet-capabilities.mjs doctor [--json] [--dense]

Types:
  ${CAPABILITY_TYPES.join(', ')}

Output:
  --json    Versioned success/error envelope for machines.
  --dense   Token-efficient tabular or compact context output.

Exit codes:
  0  Command succeeded; catalog doctor found no errors.
  1  Catalog doctor found integrity errors or an internal failure occurred.
  2  Usage, command, filter, or capability lookup error.

Examples:
  node foundry/ops/scripts/fleet-capabilities.mjs search "deploy readiness"
  node foundry/ops/scripts/fleet-capabilities.mjs search browser --type skill --json
  node foundry/ops/scripts/fleet-capabilities.mjs get skill:fleet-deploy-guard --dense
  node foundry/ops/scripts/fleet-capabilities.mjs execution skill:launch-campaign --runtime balanced:high
  node foundry/ops/scripts/fleet-capabilities.mjs context "site health" --dense
  node foundry/ops/scripts/fleet-capabilities.mjs doctor --json`;

function readOptionValue(argv, index, errorMessage) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw usageError(errorMessage);
  }
  return [value, index + 1];
}

function parseArguments(argv) {
  const options = {
    json: false,
    dense: false,
    type: undefined,
    runtime: undefined,
  };
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--dense') {
      options.dense = true;
    } else if (argument === '--type') {
      [options.type, index] = readOptionValue(argv, index, 'Expected a capability type after --type.');
    } else if (argument.startsWith('--type=')) {
      options.type = argument.slice('--type='.length);
    } else if (argument === '--runtime') {
      [options.runtime, index] = readOptionValue(argv, index, 'Expected intelligence:reasoning after --runtime.');
    } else if (argument.startsWith('--runtime=')) {
      options.runtime = argument.slice('--runtime='.length);
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('-')) {
      throw usageError(`Unknown option: ${argument}`);
    } else {
      positionals.push(argument);
    }
  }

  if (options.type && !CAPABILITY_TYPES.includes(options.type)) {
    const error = new Error(`Unknown capability type: ${options.type}`);
    error.code = ERROR_CODES.invalidType;
    error.suggestions = CAPABILITY_TYPES;
    throw error;
  }
  return { options, positionals };
}

function usageError(message) {
  const error = new Error(message);
  error.code = ERROR_CODES.usage;
  error.suggestions = ['Run with --help to see the command contract.'];
  return error;
}

function editDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
  }
  return rows[left.length][right.length];
}

function commandSuggestions(command) {
  return COMMANDS
    .map((candidate) => ({ candidate, distance: editDistance(command, candidate) }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 2)
    .map(({ candidate }) => candidate);
}

function denseRows(items) {
  return {
    format: 'dense',
    columns: ['id', 'name', 'summary', 'execution'],
    rows: items.map((item) => {
      const profile = item.executionProfile;
      const execution = profile
        ? `recommended=${profile.recommended.intelligence}:${profile.recommended.reasoning};`
          + `minimum=${profile.minimum.intelligence}:${profile.minimum.reasoning};`
          + `degradation=${profile.degradation}`
        : '';
      return [item.id, item.name, item.summary, execution];
    }),
  };
}

function printItems(items, { dense }) {
  if (dense) {
    console.log(items.map((item) => {
      const profile = item.executionProfile;
      const execution = profile
        ? `recommended=${profile.recommended.intelligence}:${profile.recommended.reasoning};`
          + `minimum=${profile.minimum.intelligence}:${profile.minimum.reasoning};`
          + `degradation=${profile.degradation}`
        : '';
      return `${item.id}\t${item.name}\t${item.summary}\t${execution}`;
    }).join('\n'));
    return;
  }

  if (items.length === 0) {
    console.log('No matching Fleet capabilities.');
    return;
  }

  for (const item of items) {
    console.log(`${item.id}  ${item.name}`);
    console.log(`  ${item.summary}`);
    console.log(`  ${item.path}`);
    if (item.executionProfile) {
      const profile = item.executionProfile;
      console.log(
        `  execution: recommended=${profile.recommended.intelligence}:${profile.recommended.reasoning} `
        + `minimum=${profile.minimum.intelligence}:${profile.minimum.reasoning} `
        + `degradation=${profile.degradation}`,
      );
    }
  }
}

function emitSuccess(command, data, meta, options, humanPrinter) {
  if (options.json) {
    console.log(JSON.stringify(successEnvelope(command, data, meta), null, 2));
  } else {
    humanPrinter();
  }
}

function emitFailure(command, error, options, exitCode = 2) {
  const code = error.code || ERROR_CODES.internal;
  const suggestions = error.suggestions || [];
  if (options.json) {
    console.error(JSON.stringify(errorEnvelope(
      command,
      code,
      error.message,
      suggestions,
    ), null, 2));
  } else {
    console.error(`${code}: ${error.message}`);
    for (const suggestion of suggestions) console.error(`  Try: ${suggestion}`);
  }
  process.exitCode = exitCode;
}

function validatePositionals(command, positionals) {
  if (command === 'list' && positionals.length > 0) {
    throw usageError('list does not accept positional arguments.');
  }
  if (command === 'search' && positionals.length === 0) {
    throw usageError('search requires a query.');
  }
  if (command === 'get' && positionals.length !== 1) {
    throw usageError('get requires exactly one namespaced capability identifier.');
  }
  if (command === 'execution' && positionals.length !== 1) {
    throw usageError('execution requires exactly one skill identifier.');
  }
  if (command === 'doctor' && positionals.length > 0) {
    throw usageError('doctor does not accept positional arguments.');
  }
}

function runCommand(command, positionals, options) {
  validatePositionals(command, positionals);
  const catalog = buildCatalog();

  if (command === 'list') {
    const items = listCapabilities(catalog, { type: options.type });
    const data = options.dense ? denseRows(items) : { items };
    emitSuccess(command, data, {
      count: items.length,
      type: options.type || null,
    }, options, () => printItems(items, options));
    return;
  }

  if (command === 'search') {
    const query = positionals.join(' ');
    const items = searchCapabilities(catalog, query, { type: options.type });
    const data = options.dense ? denseRows(items) : { query, items };
    emitSuccess(command, data, {
      count: items.length,
      type: options.type || null,
    }, options, () => printItems(items, options));
    return;
  }

  if (command === 'get') {
    const id = positionals[0];
    const item = getCapability(catalog, id);
    if (!item) {
      const error = new Error(`Capability not found: ${id}`);
      error.code = ERROR_CODES.notFound;
      error.suggestions = searchCapabilities(catalog, id.replace(/^[^:]+:/, ''), {
        limit: 3,
      }).map((candidate) => candidate.id);
      throw error;
    }
    const data = options.dense ? denseRows([item]) : { item };
    emitSuccess(command, data, {}, options, () => printItems([item], options));
    return;
  }

  if (command === 'execution') {
    const id = positionals[0];
    if (!id.startsWith('skill:')) {
      throw usageError('execution accepts only a skill identifier.');
    }
    const item = getCapability(catalog, id);
    if (!item) {
      const error = new Error(`Capability not found: ${id}`);
      error.code = ERROR_CODES.notFound;
      error.suggestions = searchCapabilities(catalog, id.replace(/^skill:/, ''), {
        type: 'skill',
        limit: 3,
      }).map((candidate) => candidate.id);
      throw error;
    }
    if (!options.runtime) {
      throw usageError('execution requires --runtime <intelligence:reasoning>.');
    }
    const [intelligence, reasoning, ...extra] = options.runtime.split(':');
    if (extra.length > 0 || !intelligence || !reasoning) {
      throw usageError('runtime must use intelligence:reasoning format.');
    }
    const decision = evaluateExecutionProfile(item.executionProfile, {
      intelligence,
      reasoning,
    });
    emitSuccess(command, {
      item,
      decision,
    }, {}, options, () => {
      if (options.dense) {
        console.log([
          item.id,
          decision.status,
          decision.action,
          `runtime=${intelligence}:${reasoning}`,
          `recommended=${item.executionProfile.recommended.intelligence}:${item.executionProfile.recommended.reasoning}`,
          `minimum=${item.executionProfile.minimum.intelligence}:${item.executionProfile.minimum.reasoning}`,
        ].join('\t'));
      } else {
        console.log(`${item.id}: ${decision.status}`);
        console.log(`  action: ${decision.action}`);
        console.log(`  runtime: ${intelligence}:${reasoning}`);
        console.log(
          `  recommended: ${item.executionProfile.recommended.intelligence}:`
          + item.executionProfile.recommended.reasoning,
        );
        console.log(
          `  minimum: ${item.executionProfile.minimum.intelligence}:`
          + item.executionProfile.minimum.reasoning,
        );
      }
    });
    return;
  }

  if (command === 'context') {
    const query = positionals.join(' ') || undefined;
    const content = generateContext(catalog, {
      query,
      type: options.type,
      dense: options.dense,
    });
    const count = query
      ? searchCapabilities(catalog, query, {
        type: options.type,
        limit: Number.POSITIVE_INFINITY,
      }).length
      : listCapabilities(catalog, { type: options.type }).length;
    emitSuccess(command, {
      format: options.dense ? 'dense' : 'markdown',
      content,
    }, {
      count,
      query: query || null,
      type: options.type || null,
    }, options, () => console.log(content));
    return;
  }

  const diagnosis = diagnoseCatalog(catalog);
  emitSuccess(command, diagnosis, diagnosis.counts, options, () => {
    if (options.dense) {
      console.log([
        diagnosis.healthy ? 'PASS' : 'FAIL',
        `items=${diagnosis.counts.items}`,
        `roots=${diagnosis.counts.roots}`,
        `errors=${diagnosis.counts.errors}`,
        `warnings=${diagnosis.counts.warnings}`,
      ].join('\t'));
    } else {
      console.log(`${diagnosis.healthy ? 'PASS' : 'FAIL'} Fleet capability catalog`);
      console.log(
        `${diagnosis.counts.items} items, ${diagnosis.counts.roots} roots, `
        + `${diagnosis.counts.errors} errors, ${diagnosis.counts.warnings} warnings`,
      );
      for (const issue of diagnosis.issues) {
        console.log(`${issue.level.toUpperCase()} ${issue.code}: ${issue.message}`);
      }
    }
  });
  if (!diagnosis.healthy) process.exitCode = 1;
}

function main() {
  let parsed = {
    options: {
      json: process.argv.includes('--json'),
      dense: false,
    },
    positionals: [],
  };
  let command = process.argv[2] || 'help';

  try {
    parsed = parseArguments(process.argv.slice(3));
    if (command === 'help' || parsed.options.help) {
      console.log(HELP);
      return;
    }
    if (!COMMANDS.includes(command)) {
      const error = new Error(`Unknown command: ${command}`);
      error.code = ERROR_CODES.unknownCommand;
      error.suggestions = commandSuggestions(command);
      throw error;
    }
    runCommand(command, parsed.positionals, parsed.options);
  } catch (error) {
    emitFailure(
      command,
      error,
      parsed.options,
      !error.code || error.code === ERROR_CODES.internal ? 1 : 2,
    );
  }
}

main();
