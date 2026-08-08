/**
 * Vite config for the headless measurement/audit scripts.
 *
 * The root `vite.config.ts` exists to build the renderer, so it loads
 * `@vitejs/plugin-react`, which pulls in rolldown. None of that is reachable
 * from a headless script -- these entry points import engine and policy
 * modules only -- but vite-node would still load the root config (and so
 * rolldown) before running a single line. Pointing the scripts at this config
 * keeps them dependent on nothing but the TypeScript they actually execute.
 *
 * Being `.mjs` matters: vite imports a plain-JS config directly instead of
 * bundling it first, so the script runner needs no bundler of its own.
 */
export default {
  // Scripts import via `../src/...`, so the project root is the repo root.
  root: process.cwd(),
};
