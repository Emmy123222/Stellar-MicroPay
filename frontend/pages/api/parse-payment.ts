import type { NextApiRequest, NextApiResponse } from "next";

interface PaymentIntent {
    amount: string;
    recipient: string;
    memo: string;
    isValid: boolean;
    clarification: string;
}

const CORE_EXTRACTION_PROMPT = (input: string) => `
You are a payment intent parser.

Your task is to extract structured payment details from a natural language request.

Return ONLY valid JSON in this exact format:
{
  "amount": "",
  "recipient": "",
  "memo": "",
  "isValid": true,
  "clarification": ""
}

Rules:
- "amount" must include number + currency if mentioned (e.g. "50 XLM")
- "recipient" should be a wallet address, username, or name if no address is provided
- "memo" should describe the purpose of the payment in a few words
- If ANY required detail is missing or ambiguous, set "isValid" to false
- If isValid is false, fill "clarification" with a short question asking for the missing info
- Never guess values
- Never add extra fields
- Output ONLY JSON (no explanation, no text)

Examples:

Input: "Send 50 XLM to GABC123 for design work"
Output: {
  "amount": "50 XLM",
  "recipient": "GABC123",
  "memo": "design work",
  "isValid": true,
  "clarification": ""
}

Input: "Pay Alice for the job"
Output: {
  "amount": "",
  "recipient": "Alice",
  "memo": "job",
  "isValid": false,
  "clarification": "What amount should be sent?"
}

Now process this: "${input}"
`;

const STRICT_VALIDATION_RULES = `
You must strictly extract only what is explicitly stated.

Do NOT infer or assume:
- If amount is not explicitly stated → leave it empty
- If recipient is unclear → leave it empty
- If memo is unclear → leave it empty

If any required field is missing:
- Set "isValid": false
- Ask a clear follow-up question in "clarification"

Return ONLY JSON.
`;

const WALLET_AWARENESS_RULES = `
Recognize Stellar (XLM) wallet addresses:
- Usually uppercase alphanumeric strings starting with "G"
- Example: GABC123XYZ...

If a valid address is present, prioritize it as "recipient" over names.

If both name and address exist:
- Use address as recipient
- Ignore the name OR include name in memo if useful
`;

const MULTI_INTENT_GUARD = `
If the input contains multiple payments or recipients:
- Set "isValid": false
- clarification: "Multiple payments detected. Please send one payment at a time."
`;

const safeParse = (text: string): PaymentIntent => {
    try {
        return JSON.parse(text);
    } catch {
        return {
            amount: "",
            recipient: "",
            memo: "",
            isValid: false,
            clarification: "I couldn't understand that. Try: Send 50 XLM to GABC123 for design work.",
        };
    }
};

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<PaymentIntent>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({
            amount: "",
            recipient: "",
            memo: "",
            isValid: false,
            clarification: "Method not allowed",
        });
    }

    const { input } = req.body;

    if (!input || typeof input !== 'string') {
        return res.status(400).json({
            amount: "",
            recipient: "",
            memo: "",
            isValid: false,
            clarification: "Please provide a payment description.",
        });
    }

    try {
        const prompt = `
${CORE_EXTRACTION_PROMPT(input)}

${STRICT_VALIDATION_RULES}

${WALLET_AWARENESS_RULES}

${MULTI_INTENT_GUARD}
`;

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": process.env.ANTHROPIC_API_KEY!,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: "claude-3-haiku-20240307",
                max_tokens: 300,
                messages: [
                    {
                        role: "user",
                        content: prompt,
                    },
                ],
            }),
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || "{}";

        const parsed = safeParse(text);

        return res.status(200).json(parsed);
    } catch (error) {
        console.error('Payment parsing error:', error);
        return res.status(500).json({
            amount: "",
            recipient: "",
            memo: "",
            isValid: false,
            clarification: "Server error. Try again.",
        });
    }
}