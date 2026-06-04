import { connectDB, disconnectDB } from './connection';
import { Customer } from '../models/Customer';
import { logger } from '../utils/logger';

const CITIES = ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Hyderabad', 'Pune', 'Kolkata', 'Jaipur', 'Ahmedabad', 'Lucknow'];
const TAGS = ['electronics', 'fashion', 'food', 'wellness', 'sports', 'home', 'books', 'travel'];
const FIRST_NAMES = ['Aarav', 'Aditi', 'Amit', 'Anjali', 'Arjun', 'Deepika', 'Divya', 'Gaurav', 'Kavya', 'Kiran', 'Manish', 'Meera', 'Neha', 'Nikhil', 'Pooja', 'Priya', 'Rahul', 'Rajesh', 'Riya', 'Rohit', 'Sakshi', 'Shivam', 'Shreya', 'Suresh', 'Tanvi', 'Varun', 'Vikram', 'Vinita', 'Vivek', 'Zara'];
const LAST_NAMES = ['Sharma', 'Verma', 'Singh', 'Kumar', 'Gupta', 'Patel', 'Mehta', 'Joshi', 'Nair', 'Reddy', 'Iyer', 'Kapoor', 'Malhotra', 'Bose', 'Choudhary'];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function buildCustomer(index: number) {
  const firstName = randomElement(FIRST_NAMES);
  const lastName = randomElement(LAST_NAMES);
  const city = randomElement(CITIES);
  const orderCount = randomInt(0, 40);
  const totalSpend = orderCount * randomInt(400, 3500);

  let segment: 'high-value' | 'mid' | 'casual';
  if (totalSpend > 50000 || orderCount > 20) segment = 'high-value';
  else if (totalSpend > 15000 || orderCount > 7) segment = 'mid';
  else segment = 'casual';

  const dormancyOptions = [10, 20, 35, 50, 65, 80, 95, 120, 150, 200];
  const lastOrderDaysAgo = randomElement(dormancyOptions) + randomInt(0, 10);

  const numTags = randomInt(1, 3);
  const tags: string[] = [];
  const shuffled = [...TAGS].sort(() => Math.random() - 0.5);
  tags.push(...shuffled.slice(0, numTags));

  const discountHistory = [];
  if (Math.random() > 0.6) {
    discountHistory.push({
      amount: randomElement([10, 15, 20, 25]),
      appliedAt: daysAgo(randomInt(5, 120)),
      campaignId: `campaign-seed-${index}`,
    });
  }

  return {
    name: `${firstName} ${lastName}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@example.com`,
    phone: `+91${randomInt(7000000000, 9999999999)}`,
    city,
    segment,
    totalSpend,
    orderCount,
    lastOrderDate: daysAgo(lastOrderDaysAgo),
    tags,
    discountHistory,
    engagementScore: randomInt(20, 95),
  };
}

async function seed() {
  await connectDB();

  const existing = await Customer.countDocuments();
  if (existing > 0) {
    logger.warn(`Database already has ${existing} customers. Run with --force to reseed.`);
    const force = process.argv.includes('--force');
    if (!force) {
      await disconnectDB();
      return;
    }
    await Customer.deleteMany({});
    logger.info('Cleared existing customers');
  }

  const count = 500;
  const batchSize = 100;
  logger.info(`Seeding ${count} customers...`);

  for (let i = 0; i < count; i += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, count - i) }, (_, j) =>
      buildCustomer(i + j)
    );
    await Customer.insertMany(batch, { ordered: false });
    logger.dim(`Inserted ${Math.min(i + batchSize, count)}/${count}`);
  }

  const stats = await Customer.aggregate([
    { $group: { _id: '$segment', count: { $sum: 1 } } },
  ]);

  logger.success(`Seeded ${count} customers:`);
  stats.forEach((s) => logger.dim(`  ${s._id}: ${s.count}`));

  await disconnectDB();
}

seed().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
