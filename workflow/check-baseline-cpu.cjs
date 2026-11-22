// Fails when a built binary's plain C needs a CPU newer than baseline x86-64.
// Standard library only, as the build job has node and binutils but nothing
// installed from npm.
//
//   node workflow/check-baseline-cpu.cjs BINARY...
//
// The cc crate compiles ring's and SQLite's C with the builder's gcc, whose
// default -march (or CFLAGS) may be newer than the target's baseline: such a
// binary dies with SIGILL on a CPU without AVX2/BMI2, in code no runtime
// feature check guards. The build pins -march in the Justfile's build-static;
// this reads the result.
//
// The limit is deliberate: only the SENTINELS below are read, C functions that
// no dispatch protects and that a newer -march changes (the x25519 base-point
// multiply that faulted, and SQLite's interpreter loop). Assembly, and Rust
// code behind a `target_feature` or runtime check, legitimately holds AVX2 and
// BMI2 and is not inspected, so C elsewhere could still be wrong. A binary
// holding no sentinel (stripped, or a renamed symbol) fails, rather than
// passing unread. Exits 0 when every binary holds a sentinel and none of them
// a newer instruction, 1 otherwise.
const {spawnSync} = require('node:child_process');

const SENTINELS = [
  /^ring_core_\d+_\d+_\d+__x25519_ge_scalarmult_base$/,
  /^sqlite3VdbeExec$/,
];
// Not a baseline x86-64 instruction: any VEX-encoded one (AVX, AVX2, FMA, all
// printed with a leading v), BMI1/BMI2 and MOVBE. tzcnt and lzcnt are left out:
// `rep bsf` and `rep bsr`, which baseline code uses, print as them.
const NEWER = /^(v[a-z0-9]+|shlx|shrx|sarx|rorx|mulx|andn|bextr|blsr|blsi|blsmsk|bzhi|pdep|pext|movbe)$/;
// Prefixes objdump prints in front of the mnemonic.
const PREFIXES = new Set(['rep', 'repz', 'repnz', 'lock', 'bnd', 'notrack', 'data16', 'addr32', 'cs', 'ds', 'es', 'fs', 'gs', 'ss']);
// The symbols' disassembly is read up to this; a sentinel is a few thousand lines.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const SHOWN = 3;

// The instructions of `disassembly` (objdump -d --no-show-raw-insn) that
// NEWER names, by the symbol holding them.
function newerInstructions(disassembly) {
  const found = new Map();
  let symbol = null;
  for (const line of disassembly.split('\n')) {
    const label = /^[0-9a-f]+ <(.+)>:$/.exec(line);
    if (label) {
      symbol = label[1];
      continue;
    }
    const insn = /^\s*[0-9a-f]+:\t(.+)$/.exec(line);
    const mnemonic = insn?.[1].trim().split(/\s+/).find((word) => !PREFIXES.has(word));
    if (symbol && mnemonic && NEWER.test(mnemonic)) {
      if (!found.has(symbol)) found.set(symbol, []);
      found.get(symbol).push(insn[1].trim());
    }
  }
  return found;
}

function tool(name, args) {
  const run = spawnSync(name, args, {encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES});
  if (run.error || run.status !== 0) {
    throw new Error(`${name} ${args.join(' ')}: ${run.error?.message ?? run.stderr.trim()}`);
  }
  return run.stdout;
}

// The problems of `binary`, one line each.
function check(binary) {
  const defined = tool('nm', ['--defined-only', binary]).split('\n').map((l) => l.trim().split(/\s+/)[2]);
  const names = [...new Set(defined.filter((name) => SENTINELS.some((s) => s.test(name ?? ''))))];
  if (names.length === 0) {
    return [`${binary}: none of the sentinel symbols ${SENTINELS.join(', ')} is in it (stripped, or renamed?)`];
  }
  // One symbol a run: given several --disassemble options, objdump reads the last.
  const text = names.map((n) => tool('objdump', ['-d', '--no-show-raw-insn', `--disassemble=${n}`, binary])).join('\n');
  return [...newerInstructions(text)].map(([symbol, found]) =>
    `${binary}: ${symbol} holds ${found.length} instruction(s) newer than baseline x86-64, ` +
    `such as ${found.slice(0, SHOWN).join('; ')}`);
}

function main(binaries) {
  if (binaries.length === 0) {
    console.error('usage: node workflow/check-baseline-cpu.cjs BINARY...');
    return 1;
  }
  const problems = binaries.flatMap(check);
  for (const problem of problems) console.error(problem);
  if (problems.length === 0) console.log(`baseline x86-64: ${binaries.join(', ')}`);
  return problems.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {newerInstructions};
