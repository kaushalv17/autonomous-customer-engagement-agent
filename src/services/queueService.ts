import { Queue, Worker, Job } from 'bullmq';
import { Campaign } from '../models/Campaign';
import { sendEmail } from './emailService';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

let emailQueue: Queue | null = null;
let emailWorker: Worker | null = null;

function getConnectionOpts() {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    maxRetriesPerRequest: null as unknown as undefined,
  };
}

export function getEmailQueue(): Queue {
  if (!emailQueue) {
    emailQueue = new Queue('campaign-emails', {
      connection: getConnectionOpts(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
  }
  return emailQueue;
}

export async function startWorker(): Promise<Worker> {
  if (emailWorker) return emailWorker;

  emailWorker = new Worker(
    'campaign-emails',
    async (job: Job) => {
      const { campaignId, messageIndex } = job.data as {
        campaignId: string;
        messageIndex: number;
      };

      const campaign = await Campaign.findById(campaignId);
      if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

      const msg = campaign.messages[messageIndex];
      if (!msg) throw new Error(`Message index ${messageIndex} not found`);

      const result = await sendEmail(msg.customerEmail, msg.subject, msg.body);

      if (result.success) {
        campaign.messages[messageIndex].status = 'sent';
        campaign.messages[messageIndex].sentAt = new Date();
        campaign.stats.sent += 1;
      } else {
        campaign.messages[messageIndex].status = 'failed';
        campaign.messages[messageIndex].errorMessage = result.error;
        campaign.stats.failed += 1;
      }

      await campaign.save();

      if (campaign.stats.sent + campaign.stats.failed >= campaign.stats.totalTargeted) {
        campaign.status = 'completed';
        await campaign.save();
        logger.success(`Campaign ${campaignId} completed: ${campaign.stats.sent} sent, ${campaign.stats.failed} failed`);
      }
    },
    {
      connection: getConnectionOpts(),
      concurrency: 3,
    }
  );

  emailWorker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed: ${err.message}`);
  });

  return emailWorker;
}

export async function enqueueCampaign(campaignId: string): Promise<void> {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const queue = getEmailQueue();
  campaign.status = 'executing';
  await campaign.save();

  const jobs = campaign.messages.map((_, index) =>
    queue.add(
      'send-email',
      { campaignId, messageIndex: index },
      { delay: index * 200 }
    )
  );

  await Promise.all(jobs);
  logger.info(`Enqueued ${campaign.messages.length} emails for campaign ${campaignId}`);
}

export async function closeQueue(): Promise<void> {
  if (emailWorker) await emailWorker.close();
  if (emailQueue) await emailQueue.close();
}
