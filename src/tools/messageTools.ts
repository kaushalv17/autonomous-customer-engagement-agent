import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../utils/config';
import { ICustomer } from '../models/Customer';
import { logger } from '../utils/logger';

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not set. Add it to your .env file.');
    }
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return genAI;
}

export interface GeneratedMessage {
  subject: string;
  body: string;
}

export async function generateMessage(
  customer: ICustomer,
  campaignGoal: string,
  offerDetails: string,
  tone: string
): Promise<GeneratedMessage> {
  const ai = getGenAI();
const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const prompt = `You are a retail marketing copywriter. Write a personalized marketing email.

Customer details:
- Name: ${customer.name}
- City: ${customer.city || 'India'}
- Segment: ${customer.segment}
- Total spend: ₹${customer.totalSpend}
- Order count: ${customer.orderCount}

Campaign goal: ${campaignGoal}
Offer details: ${offerDetails}
Tone: ${tone}

Requirements:
- Address the customer by first name
- Keep subject line under 60 characters
- Keep email body under 120 words
- Sound human, not corporate
- Include the offer clearly
- End with a single call to action

Respond in this exact JSON format:
{"subject": "...", "body": "..."}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Gemini returned invalid message format');
  }

  const parsed = JSON.parse(jsonMatch[0]) as GeneratedMessage;
  if (!parsed.subject || !parsed.body) {
    throw new Error('Gemini message missing subject or body');
  }

  return parsed;
}

export async function generateBatchMessages(
  customers: ICustomer[],
  campaignGoal: string,
  offerDetails: string,
  tone: string,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, GeneratedMessage>> {
  const results = new Map<string, GeneratedMessage>();
  const batchSize = 5;

  for (let i = 0; i < customers.length; i += batchSize) {
    const batch = customers.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (customer) => {
        try {
          const msg = await generateMessage(customer, campaignGoal, offerDetails, tone);
          results.set(customer._id.toString(), msg);
        } catch (err) {
          logger.warn(`Message generation failed for ${customer.email}: ${(err as Error).message}`);
          results.set(customer._id.toString(), {
            subject: `Special offer just for you, ${customer.name.split(' ')[0]}`,
            body: `Hi ${customer.name.split(' ')[0]},\n\nWe miss you! ${offerDetails}\n\nShop now and enjoy the savings.\n\nBest,\nThe Team`,
          });
        }
      })
    );

    if (onProgress) {
      onProgress(Math.min(i + batchSize, customers.length), customers.length);
    }

    if (i + batchSize < customers.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return results;
}
