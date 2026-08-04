/**
 * Stands in for the `server-only` package under Vitest.
 *
 * `server-only` resolves to a module that throws unless the importer is
 * resolved with React's `react-server` export condition. Vitest runs the
 * happy-dom environment, so the throwing entry wins and any module guarded by
 * `import "server-only"` fails at import time.
 *
 * Turning on the `react-server` condition globally would also switch React
 * itself to its server build, which has no `useState` — that would break the
 * component tests. Aliasing just this package (vitest.config.ts) keeps the
 * build-time guard real in `next build` while letting tests import the modules
 * it protects.
 *
 * Not collected as a suite: the include globs only match *.test.ts / *.spec.ts.
 */
export {};
