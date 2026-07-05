// Named (not anonymous) default export — matches eslint.config.mjs and keeps
// eslint's import/no-anonymous-default-export happy.
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Extends config-conventional's defaults (lower-case, non-empty type+subject,
    // 100-char header, no trailing full-stop). Only the allowed type list is
    // overridden: `CI/CD` is retired in favour of the standard `ci`, `deps` is
    // added for dependency bumps (used by history and the Dependabot config), and
    // `wip` is added for local work-in-progress checkpoints. Note: we merge with
    // merge commits, so a `wip` commit that isn't squashed away will persist in
    // `main`'s history.
    "type-enum": [
      2,
      "always",
      [
        "build",
        "chore",
        "ci",
        "deps",
        "docs",
        "feat",
        "fix",
        "perf",
        "refactor",
        "revert",
        "style",
        "test",
        "wip",
      ],
    ],
  },
};

export default config;
