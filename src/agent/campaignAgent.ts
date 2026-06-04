import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { Campaign, ICampaign } from '../models/Campaign';
import { ICustomer } from '../models/Customer';
import { queryCustomers, segmentCustomers, QueryFilters } from '../tools/customerTools';
import { generateBatchMessages } from '../tools/messageTools';

const TOOLS = [
  {
    name: 'query_customers',
    description: 'Query customers from database using filters like dormancy, segment, city, spend range, and exclude recent discount recipients.',
    parameters: {
      dormantDays: 'number — days since last order (optional)',
      segment: 'string — "high-value" | "mid" | "casual" (optional)',
      city: 'string — city name filter (optional)',
      minSpend: 'number — minimum total spend in ₹ (optional)',
      maxSpend: 'number — maximum total spend in ₹ (optional)',
      tags: 'string[] — tags to filter by (optional)',
      excludeRecentDiscount: 'number — exclude customers who received a discount in last N days (optional)',
    },
  },
  {
    name: 'segment_customers',
    description: 'Segment an already-queried customer list into high-value, mid, and casual groups for differentiated messaging.',
    parameters: {},
  },
  {
    name: 'generate_messages',
    description: 'Use AI to write personalised email subject and body for each customer based on the campaign goal and offer.',
    parameters: {
      offerDetails: 'string — the discount or offer to communicate',
      tone: 'string — writing tone for the messages',
    },
  },
  {
    name: 'build_preview',
    description: 'Compile a complete campaign preview with segment breakdown, sample messages, and scheduled time for human approval.',
    parameters: {
      scheduledAt: 'string — ISO date string for when to send (optional)',
    },
  },
  {
    name: 'finalize',
    description: 'Mark planning complete and submit the campaign for human-in-the-loop approval.',
    parameters: {},
  },
] as const;

type ToolName = (typeof TOOLS)[number]['name'];

interface ToolCall {
  tool: ToolName;
  params: Record<string, unknown>;
  reasoning: string;
}

interface AgentState {
  customers: ICustomer[];
  segments: Array<{ segment: string; customers: ICustomer[]; count: number; description: string }>;
  messages: Map<string, { subject: string; body: string }>;
  offerDetails: string;
  tone: string;
  scheduledAt?: Date;
  thoughts: string[];
}

export class CampaignAgent {
  private model: GenerativeModel;
  private campaign: ICampaign;
  private state: AgentState;
  private maxIterations = 8;

  constructor(campaign: ICampaign) {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    const ai = new GoogleGenerativeAI(config.geminiApiKey);
    this.model = ai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    this.campaign = campaign;
    this.state = {
      customers: [],
      segments: [],
      messages: new Map(),
      offerDetails: '',
      tone: 'friendly and persuasive',
      thoughts: [],
    };
  }

  async run(): Promise<ICampaign> {
    logger.agent(`Starting planning for goal: "${this.campaign.goal}"`);

    this.campaign.status = 'planning';
    await this.campaign.save();

    let iteration = 0;

    while (iteration < this.maxIterations) {
      iteration++;
      logger.agent(`Iteration ${iteration}/${this.maxIterations}`);

      await new Promise((r) => setTimeout(r, 7000));
const toolCall = await this.think();

      if (!toolCall) {
        logger.agent('Agent decided no further tool calls needed');
        break;
      }

      logger.agent(`→ ${toolCall.tool}: ${toolCall.reasoning}`);
      this.state.thoughts.push(`[Step ${iteration}] ${toolCall.tool}: ${toolCall.reasoning}`);

      const shouldStop = await this.act(toolCall);
      if (shouldStop) break;
    }

    this.campaign.agentThoughts = this.state.thoughts;
    await this.campaign.save();

    return this.campaign;
  }

  private async think(): Promise<ToolCall | null> {
    const systemPrompt = `You are CampaignMind, an autonomous marketing orchestration agent for a retail platform.
    
You must plan and execute a customer engagement campaign step by step using the available tools.
Always reason before acting. Be precise about what data you have and what you still need.

Available tools:
${TOOLS.map((t) => `- ${t.name}: ${t.description}`).join('\n')}

Current state:
- Customers queried: ${this.state.customers.length}
- Segments ready: ${this.state.segments.length > 0 ? this.state.segments.map((s) => `${s.segment}(${s.count})`).join(', ') : 'none'}
- Messages generated: ${this.state.messages.size}
- Offer defined: ${this.state.offerDetails || 'none yet'}
- Campaign in messages array: ${this.campaign.messages.length}

Previous thoughts:
${this.state.thoughts.slice(-3).join('\n') || 'none yet'}

Campaign goal: "${this.campaign.goal}"

Respond ONLY with valid JSON in this exact format — no extra text:
{
  "thought": "your reasoning about what to do next",
  "tool": "tool_name or null if done",
  "params": {},
  "reasoning": "one sentence explaining why this tool now"
}

If customers have been queried, segmented, messages generated, and campaign messages built — call finalize.
If all steps are done and you called finalize already, respond with tool: null.`;

    const result = await this.model.generateContent(systemPrompt);
    const text = result.response.text().trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Agent returned non-JSON response, stopping');
      return null;
    }

    let parsed: { thought: string; tool: string | null; params: Record<string, unknown>; reasoning: string };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      logger.warn('Agent JSON parse failed, stopping');
      return null;
    }

    if (!parsed.tool) return null;

    return {
      tool: parsed.tool as ToolName,
      params: parsed.params || {},
      reasoning: parsed.reasoning || parsed.thought || '',
    };
  }

  private async act(toolCall: ToolCall): Promise<boolean> {
    switch (toolCall.tool) {
      case 'query_customers': {
        const filters = toolCall.params as QueryFilters;
        this.state.customers = await queryCustomers(filters);
        this.campaign.filters = filters as Record<string, unknown>;
        logger.success(`Queried ${this.state.customers.length} customers`);
        return false;
      }

      case 'segment_customers': {
        if (this.state.customers.length === 0) {
          logger.warn('No customers to segment — running query first');
          this.state.customers = await queryCustomers({});
        }
        this.state.segments = await segmentCustomers(this.state.customers);
        this.campaign.segmentBreakdown = this.state.segments.map((s) => ({
          segment: s.segment,
          count: s.count,
          description: s.description,
        }));
        logger.success(`Segmented into ${this.state.segments.length} groups`);
        return false;
      }

      case 'generate_messages': {
        const offerDetails = (toolCall.params.offerDetails as string) || 'exclusive discount for you';
        const tone = (toolCall.params.tone as string) || 'friendly and persuasive';
        this.state.offerDetails = offerDetails;
        this.state.tone = tone;

        if (this.state.segments.length === 0) {
          this.state.segments = await segmentCustomers(this.state.customers);
        }

        let done = 0;
        const total = this.state.customers.length;

        for (const seg of this.state.segments) {
          const segTone = this.getToneForSegment(seg.segment, tone);
          const msgs = await generateBatchMessages(
            seg.customers,
            this.campaign.goal,
            offerDetails,
            segTone,
            (segDone) => {
              done = done + 1;
              if (done % 10 === 0) logger.dim(`Generated ${done}/${total} messages`);
            }
          );
          msgs.forEach((v, k) => this.state.messages.set(k, v));
        }

        logger.success(`Generated ${this.state.messages.size} personalised messages`);
        return false;
      }

      case 'build_preview': {
        const scheduledAtRaw = toolCall.params.scheduledAt as string | undefined;
        if (scheduledAtRaw) {
          this.state.scheduledAt = new Date(scheduledAtRaw);
        }

        this.campaign.messages = [];

        for (const seg of this.state.segments) {
          for (const customer of seg.customers) {
            const customerId = customer._id.toString();
            const msg = this.state.messages.get(customerId);
            if (msg) {
              this.campaign.messages.push({
                customerId,
                customerName: customer.name,
                customerEmail: customer.email,
                segment: seg.segment,
                subject: msg.subject,
                body: msg.body,
                status: 'pending',
              });
            }
          }
        }

        this.campaign.stats.totalTargeted = this.campaign.messages.length;
        if (this.state.scheduledAt) {
          this.campaign.scheduledAt = this.state.scheduledAt;
        }

        await this.campaign.save();
        logger.success(`Built preview with ${this.campaign.messages.length} messages`);
        return false;
      }

      case 'finalize': {
        this.campaign.status = 'pending_approval';
        this.campaign.agentPlan = this.state.thoughts;
        await this.campaign.save();
        logger.success('Campaign submitted for approval');
        return true;
      }

      default:
        logger.warn(`Unknown tool: ${toolCall.tool}`);
        return false;
    }
  }

  private getToneForSegment(segment: string, baseTone: string): string {
    if (segment === 'high-value') return `${baseTone}, premium and exclusive`;
    if (segment === 'mid') return `${baseTone}, warm and appreciative`;
    return `${baseTone}, urgent and deal-focused`;
  }
}
