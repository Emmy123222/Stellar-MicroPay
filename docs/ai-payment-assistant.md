# AI Payment Assistant

The AI Payment Assistant is an intelligent feature that allows users to describe payments in natural language and automatically fills out the payment form with the extracted details.

## Features

- **Natural Language Processing**: Users can describe payments in plain English
- **Smart Extraction**: Automatically extracts amount, recipient address, and memo
- **Validation & Clarification**: Shows helpful prompts for missing information
- **Form Pre-filling**: Seamlessly integrates with the existing SendPaymentForm
- **Floating Button**: Accessible from anywhere on the dashboard
- **Error Handling**: Graceful fallbacks and user-friendly error messages

## How It Works

1. **User clicks the floating AI button** (✨ sparkles icon in bottom-right)
2. **Types natural language** like "Send 50 XLM to GABC123... for design work"
3. **Claude AI parses the intent** and extracts structured payment data
4. **User confirms the details** in a clean preview interface
5. **Payment form gets pre-filled** automatically
6. **User can review and submit** the payment normally

## Example Inputs

The AI assistant can understand various natural language formats:

```
✅ "Send 50 XLM to GABC123... for design work"
✅ "Pay Alice 25 XLM for consulting"
✅ "Transfer 100 XLM to my colleague for the project"
✅ "Send payment of 75 XLM to GDEF456... memo: invoice payment"
✅ "Pay 30 XLM to GHIJ789... for freelance work"
```

## Setup

### Environment Variables

Add your Anthropic API key to your `.env.local` file:

```bash
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

### API Endpoint

The assistant uses the `/api/parse-payment` endpoint which:
- Accepts POST requests with natural language input
- Uses Claude Haiku model for parsing
- Returns structured payment data
- Handles validation and error cases

## Technical Implementation

### Components

1. **AIPaymentAssistant.tsx** - Main modal component
2. **FloatingAssistantButton** - Floating action button
3. **parse-payment.ts** - API endpoint for Claude integration

### Integration Points

- **Dashboard**: Hosts the floating button and modal
- **SendPaymentForm**: Accepts `aiPrefill` prop for form population
- **Validation**: Uses existing Stellar address validation

### Error Handling

The assistant handles various error scenarios:
- Invalid or missing API key
- Network failures
- Ambiguous payment descriptions
- Invalid Stellar addresses
- Missing required fields

## Usage Examples

### Basic Payment
```
Input: "Send 50 XLM to GABC123 for design work"
Output: 
- Amount: "50 XLM"
- Recipient: "GABC123"
- Memo: "design work"
```

### Incomplete Information
```
Input: "Pay Alice for the job"
Output: 
- Clarification: "What amount should be sent?"
- Shows retry interface
```

### Multiple Recipients (Not Supported)
```
Input: "Send 50 XLM to Alice and 30 XLM to Bob"
Output:
- Clarification: "Multiple payments detected. Please send one payment at a time."
```

## Testing

Run the test suite:

```bash
npm test AIPaymentAssistant.test.tsx
```

Tests cover:
- Component rendering
- User interactions
- API integration
- Error handling
- Form integration

## Accessibility

The AI assistant is fully accessible:
- Keyboard navigation support
- Screen reader compatible
- ARIA labels and roles
- Focus management
- Escape key handling

## Performance

- Lightweight Claude Haiku model for fast responses
- Minimal bundle size impact
- Efficient state management
- Optimized re-renders

## Future Enhancements

Potential improvements:
- Support for multiple currencies
- Batch payment processing
- Voice input integration
- Payment templates and shortcuts
- Advanced parsing for complex scenarios