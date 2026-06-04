import { parse } from 'csv-parse';
import { createReadStream, existsSync } from 'fs';
import { resolve } from 'path';
import { connectDB, disconnectDB } from '../db/connection';
import { Customer } from '../models/Customer';
import { logger } from '../utils/logger';

interface RawRow {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  total_spend?: string;
  totalSpend?: string;
  order_count?: string;
  orderCount?: string;
  last_order_date?: string;
  lastOrderDate?: string;
  segment?: string;
  tags?: string;
}

function inferSegment(totalSpend: number, orderCount: number): 'high-value' | 'mid' | 'casual' {
  if (totalSpend > 50000 || orderCount > 20) return 'high-value';
  if (totalSpend > 15000 || orderCount > 7) return 'mid';
  return 'casual';
}

async function importCSV(filePath: string, mode: 'upsert' | 'append' = 'upsert') {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    logger.error(`File not found: ${absolutePath}`);
    logger.info('Expected CSV columns: name, email, phone, city, total_spend, order_count, last_order_date, segment, tags');
    process.exit(1);
  }

  await connectDB();

  const rows: RawRow[] = await new Promise((resolve, reject) => {
    const records: RawRow[] = [];
    createReadStream(absolutePath)
      .pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
        })
      )
      .on('data', (row: RawRow) => records.push(row))
      .on('end', () => resolve(records))
      .on('error', reject);
  });

  logger.info(`Parsed ${rows.length} rows from ${filePath}`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.email || !row.name) {
      logger.warn(`Skipping row — missing required field (name or email): ${JSON.stringify(row)}`);
      skipped++;
      continue;
    }

    const email = row.email.toLowerCase().trim();
    const totalSpend = parseFloat(row.total_spend || row.totalSpend || '0') || 0;
    const orderCount = parseInt(row.order_count || row.orderCount || '0', 10) || 0;
    const lastOrderDate = row.last_order_date || row.lastOrderDate
      ? new Date(row.last_order_date || row.lastOrderDate || '')
      : undefined;

    const tags = row.tags
      ? row.tags.split(/[,;|]/).map((t) => t.trim()).filter(Boolean)
      : [];

    const segment =
      (row.segment as 'high-value' | 'mid' | 'casual') || inferSegment(totalSpend, orderCount);

    const doc = {
      name: row.name.trim(),
      email,
      phone: row.phone?.trim() || '',
      city: row.city?.trim() || '',
      totalSpend,
      orderCount,
      lastOrderDate,
      segment,
      tags,
    };

    if (mode === 'upsert') {
      const result = await Customer.updateOne(
        { email },
        { $set: doc },
        { upsert: true }
      );
      if (result.upsertedCount > 0) inserted++;
      else updated++;
    } else {
      const exists = await Customer.exists({ email });
      if (!exists) {
        await Customer.create(doc);
        inserted++;
      } else {
        skipped++;
      }
    }
  }

  logger.success(`Import complete — inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}`);
  await disconnectDB();
}

const [, , filePath, modeArg] = process.argv;

if (!filePath) {
  logger.error('Usage: npm run import <path-to-csv> [upsert|append]');
  logger.info('Columns: name, email, phone, city, total_spend, order_count, last_order_date, segment, tags');
  process.exit(1);
}

importCSV(filePath, modeArg === 'append' ? 'append' : 'upsert').catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
