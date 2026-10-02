# Custom ESLint Rules

This directory contains custom ESLint rules specific to the Stellar MicroPay backend.

## Available Rules

### no-duplicate-route-mounts

**Purpose**: Prevents duplicate Express route mounts which can cause:
- Redundant processing overhead
- Double-execution of business logic
- Inconsistent behavior and unpredictable side effects
- Data integrity issues

**Configuration**: Enabled as an error in `.eslintrc.js`

**Example of detected issue**:
```javascript
// ❌ Bad - will trigger error
app.use("/api/accounts", accountRoutes);
app.use("/api/accounts", accountRoutes); // Duplicate!

// ✅ Good - only one mount per path/handler combination
app.use("/api/accounts", accountRoutes);
```

## Usage

The rules are automatically loaded via `eslint-plugin-rulesdir` configured in `.eslintrc.js`.

To run the linter:
```bash
npm run lint
```

## Adding New Rules

1. Create a new rule file in this directory (e.g., `my-rule.js`)
2. Export a rule object with `meta` and `create` properties
3. Add the rule to `.eslintrc.js` rules configuration:
   ```javascript
   rules: {
     "rulesdir/my-rule": "error"
   }
   ```

See [ESLint Custom Rules Documentation](https://eslint.org/docs/latest/extend/custom-rules) for more details.
