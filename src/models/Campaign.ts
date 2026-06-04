import mongoose, { Document, Schema } from 'mongoose';

export type CampaignStatus =
  | 'planning'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed';

export interface ICampaignMessage {
  customerId: string;
  customerName: string;
  customerEmail: string;
  segment: string;
  subject: string;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt?: Date;
  errorMessage?: string;
}

export interface ICampaign extends Document {
  goal: string;
  status: CampaignStatus;
  agentPlan: string[];
  segmentBreakdown: Array<{
    segment: string;
    count: number;
    description: string;
  }>;
  messages: ICampaignMessage[];
  filters: Record<string, unknown>;
  scheduledAt?: Date;
  approvedBy?: string;
  rejectionReason?: string;
  stats: {
    totalTargeted: number;
    sent: number;
    failed: number;
  };
  agentThoughts: string[];
  createdAt: Date;
  updatedAt: Date;
}

const campaignSchema = new Schema<ICampaign>(
  {
    goal: { type: String, required: true },
    status: {
      type: String,
      enum: ['planning', 'pending_approval', 'approved', 'rejected', 'executing', 'completed', 'failed'],
      default: 'planning',
    },
    agentPlan: [{ type: String }],
    segmentBreakdown: [
      {
        segment: String,
        count: Number,
        description: String,
      },
    ],
    messages: [
      {
        customerId: String,
        customerName: String,
        customerEmail: String,
        segment: String,
        subject: String,
        body: String,
        status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
        sentAt: Date,
        errorMessage: String,
      },
    ],
    filters: { type: Schema.Types.Mixed, default: {} },
    scheduledAt: Date,
    approvedBy: String,
    rejectionReason: String,
    stats: {
      totalTargeted: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    agentThoughts: [{ type: String }],
  },
  { timestamps: true }
);

export const Campaign = mongoose.model<ICampaign>('Campaign', campaignSchema);
