import { cpus } from "node:os";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

/*
  The cast crosses a real version boundary, and removing it will not typecheck.

  This project builds on vite 8.1.5, but vitest 3.2.7 depends on vite 6 and npm
  installs that second copy under `node_modules/vitest/node_modules/vite`.
  `defineConfig` imported from `vitest/config` therefore types `plugins` against
  vite 6's `Plugin`, while `@vitejs/plugin-react` returns vite 8's -- and the
  two are structurally incompatible (vite 8 changed the `this` type of the
  `hotUpdate` hook). The import has to come from `vitest/config` for the `test`
  key below to be typed at all.

  This was introduced in 13dc42a, which added the `test` key and switched the
  import, and it broke `tsc --noEmit` -- and so the "TypeScript strict
  verification" stage of release verification -- until it was found here.
  The plugin itself is unchanged at runtime; only the declaration is bridged.
*/
const reactPlugin = react() as unknown as Plugin;

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
  plugins: [reactPlugin],
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
