import { Customer, ICustomer } from '../models/Customer';
import { logger } from '../utils/logger';

export interface QueryFilters {
  dormantDays?: number;
  segment?: string;
  city?: string;
  minSpend?: number;
  maxSpend?: number;
  tags?: string[];
  excludeRecentDiscount?: number;
}

export interface SegmentResult {
  segment: string;
  customers: ICustomer[];
  count: number;
  description: string;
}

export async function queryCustomers(filters: QueryFilters): Promise<ICustomer[]> {
  const query: Record<string, unknown> = {};

  if (filters.dormantDays && filters.dormantDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.dormantDays);
    query.lastOrderDate = { $lt: cutoff };
  }

  if (filters.segment) {
    query.segment = filters.segment;
  }

  if (filters.city) {
    query.city = new RegExp(filters.city, 'i');
  }

  if (filters.minSpend !== undefined || filters.maxSpend !== undefined) {
    const spendFilter: Record<string, number> = {};
    if (filters.minSpend !== undefined) spendFilter.$gte = filters.minSpend;
    if (filters.maxSpend !== undefined) spendFilter.$lte = filters.maxSpend;
    query.totalSpend = spendFilter;
  }

  if (filters.tags && filters.tags.length > 0) {
    query.tags = { $in: filters.tags };
  }

  if (filters.excludeRecentDiscount && filters.excludeRecentDiscount > 0) {
    const discountCutoff = new Date();
    discountCutoff.setDate(discountCutoff.getDate() - filters.excludeRecentDiscount);
    query['discountHistory'] = {
      $not: {
        $elemMatch: { appliedAt: { $gte: discountCutoff } },
      },
    };
  }

  const customers = await Customer.find(query).sort({ totalSpend: -1 }).lean();
  logger.dim(`queryCustomers: found ${customers.length} matching customers`);
  return customers as unknown as ICustomer[];
}

export async function segmentCustomers(customers: ICustomer[]): Promise<SegmentResult[]> {
  const groups: Record<string, ICustomer[]> = {
    'high-value': [],
    mid: [],
    casual: [],
  };

  for (const c of customers) {
    const seg = c.segment || 'casual';
    if (groups[seg]) {
      groups[seg].push(c);
    }
  }

  const results: SegmentResult[] = [];

  if (groups['high-value'].length > 0) {
    results.push({
      segment: 'high-value',
      customers: groups['high-value'],
      count: groups['high-value'].length,
      description: 'Top spenders with strong purchase history — personalised, premium tone',
    });
  }

  if (groups['mid'].length > 0) {
    results.push({
      segment: 'mid',
      customers: groups['mid'],
      count: groups['mid'].length,
      description: 'Regular buyers with growth potential — friendly, value-focused tone',
    });
  }

  if (groups['casual'].length > 0) {
    results.push({
      segment: 'casual',
      customers: groups['casual'],
      count: groups['casual'].length,
      description: 'Infrequent buyers needing re-engagement — urgent, discount-forward tone',
    });
  }

  logger.dim(`segmentCustomers: ${results.map((r) => `${r.segment}=${r.count}`).join(', ')}`);
  return results;
}

export async function getCustomerCount(): Promise<number> {
  return Customer.countDocuments();
}

export async function getCustomerStats(): Promise<{
  total: number;
  bySegment: Record<string, number>;
  avgSpend: number;
  dormant30: number;
  dormant60: number;
  dormant90: number;
}> {
  const total = await Customer.countDocuments();
  const bySegment = await Customer.aggregate([
    { $group: { _id: '$segment', count: { $sum: 1 } } },
  ]);

  const spendAgg = await Customer.aggregate([
    { $group: { _id: null, avg: { $avg: '$totalSpend' } } },
  ]);

  const now = new Date();
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d60 = new Date(now); d60.setDate(d60.getDate() - 60);
  const d90 = new Date(now); d90.setDate(d90.getDate() - 90);

  const [dormant30, dormant60, dormant90] = await Promise.all([
    Customer.countDocuments({ lastOrderDate: { $lt: d30 } }),
    Customer.countDocuments({ lastOrderDate: { $lt: d60 } }),
    Customer.countDocuments({ lastOrderDate: { $lt: d90 } }),
  ]);

  return {
    total,
    bySegment: Object.fromEntries(bySegment.map((b) => [b._id, b.count])),
    avgSpend: Math.round(spendAgg[0]?.avg ?? 0),
    dormant30,
    dormant60,
    dormant90,
  };
}
