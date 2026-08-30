module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [2, 'never', ['upper-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'type-enum': [
      2,
      'always',
      [
        'chore',    // build, deps, tooling
        'ci',       // CI/CD configuration
        'docs',     // documentation
        'feat',     // new feature
        'fix',      // bug fix
        'perf',     // performance improvement
        'refactor', // code refactoring
        'revert',   // revert previous commit
        'style',    // formatting, linting
        'test',     // tests
      ],
    ],
  },
};
