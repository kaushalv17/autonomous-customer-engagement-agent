import mongoose, { Document, Schema } from 'mongoose';

export interface ICustomer extends Document {
  name: string;
  email: string;
  phone: string;
  city: string;
  segment: 'high-value' | 'mid' | 'casual';
  totalSpend: number;
  orderCount: number;
  lastOrderDate: Date;
  tags: string[];
  discountHistory: Array<{
    amount: number;
    appliedAt: Date;
    campaignId: string;
  }>;
  engagementScore: number;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    segment: {
      type: String,
      enum: ['high-value', 'mid', 'casual'],
      default: 'casual',
    },
    totalSpend: { type: Number, default: 0, min: 0 },
    orderCount: { type: Number, default: 0, min: 0 },
    lastOrderDate: { type: Date, default: null },
    tags: [{ type: String }],
    discountHistory: [
      {
        amount: Number,
        appliedAt: Date,
        campaignId: String,
      },
    ],
    engagementScore: { type: Number, default: 50, min: 0, max: 100 },
  },
  { timestamps: true }
);

customerSchema.index({ email: 1 });
customerSchema.index({ segment: 1 });
customerSchema.index({ lastOrderDate: 1 });
customerSchema.index({ city: 1 });
customerSchema.index({ totalSpend: -1 });

export const Customer = mongoose.model<ICustomer>('Customer', customerSchema);
