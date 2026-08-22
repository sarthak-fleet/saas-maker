# Preserved legacy Fleet tooling

This directory retains source removed from active Fleet ownership during the
2026-08-21 workspace split. Nothing here is an advertised capability or an
active GitHub Actions workflow.

The retained material includes:

- reusable workflows for products that now own their CI directly;
- the retired Fleet Console and Founder Control entrypoints;
- historical analytics and portfolio collection scripts; and
- former Site Health entrypoints whose canonical implementations now live in
  `sass-maker/site-health`.

Files remain tracked for research and recovery. Their historical imports and
old `foundry/ops` paths are intentionally not maintained as runnable contracts.
Do not copy fixes into this directory or revive a second implementation here.
