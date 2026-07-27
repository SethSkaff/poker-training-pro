import { cpus } from "node:os";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/*
  Test workers are capped well below the core count on purpose.

  Much of this suite is not unit tests: the determinism, redaction, pacing, and
  bet-legality suites each play whole six-handed tournaments through the
  production policy, which is seconds of solid, uninterruptible CPU per test.
  Run one worker per core and those workers starve the main thread, whose job
  is to answer their RPCs. When a worker's `onTaskUpdate` call goes unanswered
  for 60 s Vitest raises an unhandled error and the process exits non-zero --
  *while reporting every test as passed*. `npm test` failing with "844 passed"
  and no failing test named is not a result anyone can act on, and it fails the
  first stage of release verification.

  Measured on a 12-core machine: 12 workers gave 1-4 such errors per run and
  always exited 1; 6 workers still exited 1; 4 exited 0 with 844 passing. A
  third of the cores is the rule rather than the measured 4, so the headroom
  travels to other machines instead of pinning this one's answer.

  The cost is about 20 s of wall time. The benefit is a suite whose result
  depends on the code rather than on what else the machine happens to be doing.
*/
const testWorkers = Math.max(2, Math.floor(cpus().length / 3));

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    maxWorkers: testWorkers,
    minWorkers: 1,
  },
});
