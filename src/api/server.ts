import express from 'express';
import { connectDB } from '../db/connection';
import { Campaign } from '../models/Campaign';
import { Customer } from '../models/Customer';
import { CampaignAgent } from '../agent/campaignAgent';
import { enqueueCampaign, startWorker } from '../services/queueService';
import { getCustomerStats } from '../tools/customerTools';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

const app = express();
app.use(express.json());

app.use((req, _res, next) => {
  logger.dim(`${req.method} ${req.path}`);
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

app.get('/api/stats', async (_req, res) => {
  try {
    const stats = await getCustomerStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/customers', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const segment = req.query.segment as string | undefined;

    const filter = segment ? { segment } : {};
    const [customers, total] = await Promise.all([
      Customer.find(filter)
        .sort({ totalSpend: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Customer.countDocuments(filter),
    ]);

    res.json({ customers, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const { goal } = req.body as { goal?: string };
    if (!goal || goal.trim().length < 10) {
      return res.status(400).json({ error: 'goal must be at least 10 characters' });
    }

    const campaign = await Campaign.create({ goal: goal.trim() });
    res.status(201).json({ campaignId: campaign._id, status: campaign.status });

    setImmediate(async () => {
      try {
        const agent = new CampaignAgent(campaign);
        await agent.run();
        logger.success(`Campaign ${campaign._id} planning done`);
      } catch (err) {
        logger.error(`Agent failed for ${campaign._id}: ${(err as Error).message}`);
        campaign.status = 'failed';
        await campaign.save();
      }
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/campaigns', async (_req, res) => {
  try {
    const campaigns = await Campaign.find()
      .sort({ createdAt: -1 })
      .limit(20)
      .select('-messages')
      .lean();
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/campaigns/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/campaigns/:id/approve', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'pending_approval') {
      return res.status(400).json({ error: `Cannot approve campaign in status: ${campaign.status}` });
    }

    campaign.status = 'approved';
    campaign.approvedBy = (req.body as { approvedBy?: string }).approvedBy || 'api-user';
    await campaign.save();

    await startWorker();
    await enqueueCampaign(campaign._id.toString());

    res.json({ status: 'executing', queued: campaign.stats.totalTargeted });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/campaigns/:id/reject', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    campaign.status = 'rejected';
    campaign.rejectionReason = (req.body as { reason?: string }).reason || '';
    await campaign.save();

    res.json({ status: 'rejected' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/campaigns/:id/messages', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).select('messages stats').lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ messages: campaign.messages, stats: campaign.stats });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

async function start() {
  await connectDB();
  app.listen(config.port, () => {
    logger.success(`API server running on http://localhost:${config.port}`);
    logger.info('Endpoints: POST /api/campaigns, GET /api/campaigns, POST /api/campaigns/:id/approve');
  });
}

start().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
