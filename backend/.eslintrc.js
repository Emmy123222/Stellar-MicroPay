const rulesDirPlugin = require("eslint-plugin-rulesdir");
rulesDirPlugin.RULES_DIR = "./eslint-rules";

module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  extends: "eslint:recommended",
  parserOptions: {
    ecmaVersion: "latest",
  },
  plugins: ["rulesdir"],
  rules: {
    "rulesdir/no-duplicate-route-mounts": "error",
  },
};
