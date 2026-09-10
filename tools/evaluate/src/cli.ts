#!/usr/bin/env node
/**
 * CLI entry point for batch evaluator (docs/EVALUATOR.md).
 *
 * Usage:
 *   npm run evaluate -- --input <cases.json> --output <kits.json> [--concurrency <n>] [--case-timeout <ms>] [--verbose]
 */
import { evaluateBatch } from './evaluator.js';

interface CliArgs {
  input?: string;
  output?: string;
  concurrency?: number;
  caseTimeout?: number;
  verbose: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' || arg === '-i') {
      const val = args[++i];
      if (val !== undefined) result.input = val;
    } else if (arg === '--output' || arg === '-o') {
      const val = args[++i];
      if (val !== undefined) result.output = val;
    } else if (arg === '--concurrency' || arg === '-c') {
      const next = args[++i];
      const val = next !== undefined ? Number(next) : NaN;
      if (Number.isInteger(val) && val > 0) result.concurrency = val;
    } else if (arg === '--case-timeout' || arg === '-t') {
      const next = args[++i];
      const val = next !== undefined ? Number(next) : NaN;
      if (Number.isFinite(val) && val > 0) result.caseTimeout = val;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    }
  }

  return result;
}

function printUsage(): void {
  process.stderr.write(`
AI Interview Preparation Kit - Batch Evaluator

Usage:
  npm run evaluate -- --input <cases.json> --output <kits.json> [options]

Options:
  --input, -i <path>         Path to input cases.json (required)
  --output, -o <path>        Path to output kits.json (required)
  --concurrency, -c <n>      Number of cases to process in parallel (default: 2)
  --case-timeout, -t <ms>    Per-case wall-clock ceiling in ms (default: 150000)
  --verbose, -v              Print per-stage progress to stderr
\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input || !args.output) {
    printUsage();
    process.stderr.write('Error: --input and --output flags are both required.\n');
    process.exit(1);
  }

  try {
    const envelope = await evaluateBatch({
      inputPath: args.input,
      outputPath: args.output,
      ...(args.concurrency !== undefined ? { concurrency: args.concurrency } : {}),
      ...(args.caseTimeout !== undefined ? { caseTimeoutMs: args.caseTimeout } : {}),
      verbose: args.verbose,
    });

    const successCount = envelope.kits.filter((k) => k.status === 'ok').length;
    const errorCount = envelope.kits.filter((k) => k.status === 'error').length;

    process.stdout.write(
      `Evaluator finished: ${envelope.kits.length} case(s) processed (${successCount} ok, ${errorCount} error). Report saved to ${args.output}\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      `Evaluator fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

// Compare resolved file paths to avoid issues on Windows checkouts with spaces
main().catch((err) => {
  process.stderr.write(
    `Unhandled exception: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
