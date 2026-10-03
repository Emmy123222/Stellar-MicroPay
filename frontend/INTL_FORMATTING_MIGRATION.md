# Internationalization & Formatting Migration Guide

## Overview

The Stellar MicroPay frontend has been updated to use **Intl-based formatters** for better internationalization (i18n) and accessibility support. This replaces hard-coded `toFixed()` calls, English-only date strings, and locale-specific formatting assumptions.

## What Changed

### Before (Old Approach)
```typescript
// Hard-coded English decimal format
amount.toFixed(7)  // Always uses "." as decimal separator

// Hard-coded locale
amount.toLocaleString('en-US')  // Always English/US format

// English-only dates
formatDistanceToNow(date)  // Always English relative time
```

### After (New Approach)
```typescript
// Respects user's locale automatically
formatXLM(amount)  // Uses user's decimal separator, grouping

// Automatic locale detection
formatAsset(amount, 'USDC')  // Adapts to user's locale

// Localized dates and relative time
formatRelativeTime(date)  // "3 minutes ago" / "vor 3 Minuten" / "il y a 3 minutes"
```

## Key Features

### 1. Exact Value Preservation
The formatters preserve exact machine values while localizing display:
```typescript
formatXLM(1234.5678, { locale: 'en-US' })  // "1,234.5678 XLM"
formatXLM(1234.5678, { locale: 'de-DE' })  // "1.234,5678 XLM"
formatXLM(1234.5678, { locale: 'fr-FR' })  // "1 234,5678 XLM"
```

### 2. Invalid Data Handling
All formatters handle invalid data gracefully:
```typescript
formatXLM(NaN)        // "0 XLM"
formatXLM(null)       // "0 XLM"
formatXLM(undefined)  // "0 XLM"

formatDate('invalid')  // Returns "invalid" (original string)
formatDate(null)       // Returns "null"
```

### 3. Very Small Amounts
Scientific notation for tiny USDC amounts:
```typescript
formatSmallAmount(0.00000123, 'USDC')
// "~1.23 × 10⁻⁶ USDC"

formatSmallAmount(0.001, 'USDC')
// "0.001 USDC" (no scientific notation needed)
```

### 4. Timezone Support
All date formatters respect user timezone:
```typescript
formatDate(date, { timezone: 'America/New_York' })
formatDate(date, { timezone: 'Europe/London' })
formatDate(date, { timezone: 'Asia/Tokyo' })
```

### 5. Plural Forms
Automatic pluralization for multiple languages:
```typescript
// English
pluralize(1, { one: '# item', other: '# items' })  // "1 item"
pluralize(5, { one: '# item', other: '# items' })  // "5 items"

// French (0 uses singular)
pluralize(0, { one: '# élément', other: '# éléments' }, { locale: 'fr-FR' })
// "0 élément"

// Russian (complex one/few/many rules)
pluralize(2, { one: '# элемент', few: '# элемента', other: '# элементов' }, { locale: 'ru-RU' })
// "2 элемента"
```

## API Reference

### Number Formatting

#### `formatAsset(amount, assetCode, options)`
Format an asset amount with locale-specific separators.
```typescript
formatAsset(1234.56, 'XLM')  // "1,234.56 XLM" (en-US)
formatAsset(1234.56, 'XLM', { locale: 'de-DE' })  // "1.234,56 XLM"
```

#### `formatAssetPrecise(amount, assetCode, options)`
Format with full precision (trailing zeros preserved).
```typescript
formatAssetPrecise(10, 'XLM')  // "10.0000000 XLM"
formatAssetPrecise(15, 'USDC')  // "15.000000 USDC"
```

#### `formatStroopsToXLM(stroops, options)`
Convert stroops to XLM (1 XLM = 10,000,000 stroops).
```typescript
formatStroopsToXLM(10000000n)  // "1.0000000 XLM"
formatStroopsToXLM(123456)     // "0.0123456 XLM"
```

#### `formatUSD(amount, options)`
Format USD currency.
```typescript
formatUSD(1234.56)  // "≈ $1,234.56" (en-US)
formatUSD(1234.56, { locale: 'de-DE' })  // "≈ 1.234,56 $"
formatUSD(1234.56, { showApprox: false })  // "$1,234.56"
```

### Date Formatting

#### `formatDate(date, options)`
Format date with user's locale and timezone.
```typescript
formatDate('2024-01-15T10:30:00Z')
// "Jan 15, 2024, 10:30 AM" (en-US)
// "15 janv. 2024 10:30" (fr-FR)
```

#### `formatDateFull(date, options)`
Full format with timezone name.
```typescript
formatDateFull('2024-01-15T10:30:45Z', { timezone: 'UTC' })
// "January 15, 2024 at 10:30:45 AM UTC"
```

#### `formatRelativeTime(date, options)`
Relative time with proper localization.
```typescript
formatRelativeTime(Date.now() - 180000)
// "3 minutes ago" (en-US)
// "vor 3 Minuten" (de-DE)
// "il y a 3 minutes" (fr-FR)
```

### Pluralization

#### `pluralize(count, forms, options)`
Select correct plural form for count.
```typescript
pluralize(5, {
  zero: 'no items',
  one: '# item',
  other: '# items'
})  // "5 items"
```

### Accessibility

#### `formatForScreenReader(amount, assetCode)`
Format for screen readers (ARIA labels).
```typescript
formatForScreenReader(1234.5678, 'XLM')
// "1234 point 5678 XLM"
```

### Validation

#### `validateDate(date)`
Validate date input. Returns `null` if valid, error message if invalid.
```typescript
validateDate(new Date())  // null (valid)
validateDate('invalid')   // "Invalid date value"
validateDate(null)        // "Date is required"
```

#### `validateAmount(amount, assetCode)`
Validate amount input. Returns `null` if valid, error message if invalid.
```typescript
validateAmount(100, 'XLM')  // null (valid)
validateAmount(0, 'XLM')    // "Amount must be greater than zero"
validateAmount('1.00000001', 'XLM')  // "Amount cannot have more than 7 decimal places for XLM"
```

## Migration Steps

### 1. Update Imports
```typescript
// Old
import { formatXLM, formatDate, timeAgo } from '@/utils/format';

// New (same imports work, now Intl-based)
import { formatXLM, formatDate, formatRelativeTime } from '@/utils/format';
// or for direct Intl access:
import { formatXLM, formatDate, formatRelativeTime } from '@/utils/intlFormatters';
```

### 2. Replace Hard-coded toFixed() Calls
```typescript
// Old
const formatted = `${amount.toFixed(7)} XLM`;

// New
const formatted = formatXLMPrecise(amount);
```

### 3. Replace date-fns with Intl Formatters
```typescript
// Old
import { formatDistanceToNow } from 'date-fns';
const relative = formatDistanceToNow(date, { addSuffix: true });

// New
import { formatRelativeTime } from '@/utils/format';
const relative = formatRelativeTime(date);
```

### 4. Add Plural Forms
```typescript
// Old
const label = `${count} item${count !== 1 ? 's' : ''}`;

// New
import { pluralizeIntl } from '@/utils/format';
const label = pluralizeIntl(count, {
  one: '# item',
  other: '# items'
});
```

## Testing

Comprehensive test coverage in `__tests__/intlFormatters.test.ts`:

- ✅ Invalid dates handle gracefully
- ✅ Very small USDC amounts display correctly
- ✅ Timezone handling works properly
- ✅ Plural forms respect language rules
- ✅ Exact machine values are preserved
- ✅ Multiple locales tested (en-US, de-DE, fr-FR, ru-RU)
- ✅ Edge cases covered (NaN, Infinity, null, undefined)
- ✅ Performance benchmarks (1000 ops < 100-200ms)

Run tests:
```bash
npm test intlFormatters
```

## Browser Compatibility

All formatters use standard Intl APIs supported in:
- ✅ Chrome 24+
- ✅ Firefox 29+
- ✅ Safari 10+
- ✅ Edge 12+
- ✅ Node.js 13.0+

Fallbacks are provided for unsupported features:
- Missing timezone → Falls back to 'UTC'
- Missing locale → Falls back to 'en-US'
- Invalid dates → Returns original string

## Performance

Intl formatters are cached internally by the browser for performance:
- Number formatting: < 0.1ms per operation
- Date formatting: < 0.2ms per operation
- 1000 operations complete in < 100-200ms

## Accessibility

All formatters support:
- **Screen readers**: `formatForScreenReader()` for ARIA labels
- **High contrast**: No visual-only formatting
- **Keyboard navigation**: Text content readable via keyboard
- **RTL languages**: Proper text direction handling

## Examples

### Payment Amount Display
```typescript
// Component
const PaymentDisplay = ({ amount, asset }) => {
  const formatted = formatAsset(amount, asset);
  const screenReader = formatForScreenReader(amount, asset);
  
  return (
    <span aria-label={screenReader}>
      {formatted}
    </span>
  );
};
```

### Transaction History
```typescript
// Component
const TransactionRow = ({ tx }) => {
  const amount = formatAssetPrecise(tx.amount, tx.asset);
  const date = formatDate(tx.createdAt);
  const relativeTime = formatRelativeTime(tx.createdAt);
  
  return (
    <tr>
      <td>{amount}</td>
      <td title={date}>{relativeTime}</td>
    </tr>
  );
};
```

### Batch Payment Summary
```typescript
// Component
const BatchSummary = ({ count, total }) => {
  const summary = pluralizeIntl(count, {
    one: '# payment',
    other: '# payments'
  });
  const totalFormatted = formatXLMPrecise(total);
  
  return (
    <div>
      <p>{summary}</p>
      <p>Total: {totalFormatted}</p>
    </div>
  );
};
```

## Backward Compatibility

The existing `utils/format.ts` API is **fully backward compatible**. All existing code continues to work without changes. The formatters now use Intl internally while maintaining the same function signatures.

### Breaking Changes
None! This is a non-breaking enhancement.

### Deprecations
None. All existing functions remain supported.

## Future Enhancements

Potential future improvements:
1. **User preference override**: Allow users to manually select locale
2. **Currency conversion**: Real-time XLM ↔ USD conversion
3. **Custom asset rules**: Support for new asset types
4. **Compact notation**: Large numbers (1M, 1B) for mobile
5. **Number input parsing**: Parse localized user input back to numbers

## Support

For questions or issues:
1. Check test file: `__tests__/intlFormatters.test.ts`
2. Review source: `utils/intlFormatters.ts`
3. See examples in this migration guide

## References

- [MDN: Intl.NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)
- [MDN: Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat)
- [MDN: Intl.RelativeTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat)
- [MDN: Intl.PluralRules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
