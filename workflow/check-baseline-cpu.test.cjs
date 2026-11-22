const assert = require('node:assert/strict');
const {test} = require('node:test');
const {newerInstructions} = require('./check-baseline-cpu.cjs');

test('names the symbols holding instructions a baseline x86-64 CPU lacks', () => {
  const disassembly = [
    '0000000000001000 <baseline>:',
    '    1000:\tmov    %rdi,%rax',
    '    1003:\trep bsf %rax,%rax',
    '    1006:\trep stos %al,%es:(%rdi)',
    '    1008:\tlock cmpxchg %rcx,(%rdi)',
    '    100b:\tmovdqu (%rsi),%xmm0',
    '    100f:\tret',
    '',
    '0000000000002000 <newer>:',
    '    2000:\tvpbroadcastd %xmm2,%ymm2',
    '    2005:\tshlx   %rax,%rbx,%rcx',
    '    200a:\tmulx   %rax,%rbx,%rcx',
    '    200f:\tvmovd  %xmm0,%eax',
    '    2013:\tmovbe  (%rdi),%rax',
    '    2017:\tret',
    '',
  ].join('\n');
  assert.deepEqual([...newerInstructions(disassembly)], [[
    'newer',
    [
      'vpbroadcastd %xmm2,%ymm2',
      'shlx   %rax,%rbx,%rcx',
      'mulx   %rax,%rbx,%rcx',
      'vmovd  %xmm0,%eax',
      'movbe  (%rdi),%rax',
    ],
  ]]);
});

test('finds nothing in baseline code, tzcnt spelled as rep bsf included', () => {
  const baseline = '0000000000001000 <f>:\n    1000:\ttzcnt  %rax,%rax\n    1004:\tlzcnt  %rax,%rax\n    1008:\tcmove  %rax,%rbx\n';
  assert.equal(newerInstructions(baseline).size, 0);
});
