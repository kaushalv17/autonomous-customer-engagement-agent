import * as readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { connectDB, disconnectDB } from '../db/connection';
import { Campaign } from '../models/Campaign';
import { CampaignAgent } from '../agent/campaignAgent';
import { getCustomerStats } from '../tools/customerTools';
import { enqueueCampaign, startWorker, closeQueue } from '../services/queueService';
import { logger } from '../utils/logger';
import { ICampaign } from '../models/Campaign';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> =>
  new Promise((res) => rl.question(chalk.cyan(q), (a) => res(a.trim())));

function printBanner() {
  console.log(chalk.magenta('\n╔═══════════════════════════════════════════╗'));
  console.log(chalk.magenta('║') + chalk.bold('        CampaignMind — AgentOS v1.0        ') + chalk.magenta('║'));
  console.log(chalk.magenta('║') + chalk.gray('  Agentic Retail Marketing Orchestrator    ') + chalk.magenta('║'));
  console.log(chalk.magenta('╚═══════════════════════════════════════════╝\n'));
}

function printCampaignPreview(campaign: ICampaign | null) {
  if (!campaign) return;

  console.log(chalk.bold('\n── Campaign Preview ──────────────────────────'));
  console.log(chalk.white(`Goal:    `) + chalk.yellow(campaign.goal));
  console.log(chalk.white(`Status:  `) + chalk.blue(campaign.status));
  console.log(chalk.white(`Targets: `) + chalk.green(`${campaign.stats.totalTargeted} customers`));

  if (campaign.segmentBreakdown.length > 0) {
    console.log(chalk.white('\nSegment breakdown:'));
    campaign.segmentBreakdown.forEach((s) => {
      console.log(`  ${chalk.yellow(s.segment.padEnd(12))} ${chalk.green(String(s.count).padStart(4))} customers — ${chalk.gray(s.description)}`);
    });
  }

  if (campaign.agentThoughts.length > 0) {
    console.log(chalk.white('\nAgent reasoning:'));
    campaign.agentThoughts.forEach((t) => console.log(`  ${chalk.gray(t)}`));
  }

  if (campaign.messages.length > 0) {
    console.log(chalk.white('\nSample messages:'));
    const samples = campaign.messages.slice(0, 3);
    samples.forEach((m, i) => {
      console.log(`\n  ${chalk.bold(`[${i + 1}]`)} To: ${chalk.cyan(m.customerName)} (${m.segment})`);
      console.log(`      Subject: ${chalk.yellow(m.subject)}`);
      const preview = m.body.replace(/\n/g, ' ').slice(0, 120);
      console.log(`      Body:    ${chalk.gray(preview + (m.body.length > 120 ? '...' : ''))}`);
    });

    if (campaign.messages.length > 3) {
      console.log(chalk.gray(`\n  ...and ${campaign.messages.length - 3} more`));
    }
  }

  console.log(chalk.bold('\n──────────────────────────────────────────────\n'));
}

async function runNewCampaign() {
  console.log(chalk.bold('\n── New Campaign ──────────────────────────────\n'));
  console.log(chalk.gray('Describe what you want to achieve. Examples:'));
  console.log(chalk.gray('  • Re-engage customers who haven\'t bought in 60 days with 20% off'));
  console.log(chalk.gray('  • Win back high-value Mumbai customers with a loyalty reward'));
  console.log(chalk.gray('  • Send a weekend sale alert to casual buyers\n'));

  const goal = await ask('Campaign goal: ');
  if (!goal) {
    logger.warn('No goal provided.');
    return;
  }

  const campaign = await Campaign.create({ goal });

  const spinner = ora({
    text: chalk.magenta('Agent is planning your campaign...'),
    spinner: 'dots',
  }).start();

  let agent: CampaignAgent;
  try {
    agent = new CampaignAgent(campaign);
  } catch (err) {
    spinner.fail(chalk.red((err as Error).message));
    return;
  }

  try {
    await agent.run();
    spinner.succeed(chalk.green('Agent finished planning'));
  } catch (err) {
    spinner.fail(chalk.red(`Agent error: ${(err as Error).message}`));
    campaign.status = 'failed';
    await campaign.save();
    return;
  }

  const fresh = await Campaign.findById(campaign._id);
  if (!fresh) return;

  printCampaignPreview(fresh);

  const action = await ask('Approve and send? [y]es / [n]o / [r]eject with feedback: ');

  if (action.toLowerCase() === 'y' || action.toLowerCase() === 'yes') {
    fresh.status = 'approved';
    fresh.approvedBy = 'cli-user';
    await fresh.save();

    const worker = await startWorker();
    const sendSpinner = ora('Sending emails...').start();

    try {
      await enqueueCampaign(fresh._id.toString());
      await new Promise((r) => setTimeout(r, 3000));
      sendSpinner.succeed(chalk.green(`Campaign execution started — ${fresh.stats.totalTargeted} emails queued`));
    } catch (err) {
      sendSpinner.fail(chalk.red((err as Error).message));
    } finally {
      await worker.close();
    }
  } else if (action.toLowerCase() === 'r' || action.toLowerCase() === 'reject') {
    const reason = await ask('Rejection reason: ');
    fresh.status = 'rejected';
    fresh.rejectionReason = reason;
    await fresh.save();
    logger.info('Campaign rejected. You can create a new one with a refined goal.');
  } else {
    logger.info('Campaign saved as draft. Run again to review pending campaigns.');
  }
}

async function listCampaigns() {
  const campaigns = await Campaign.find().sort({ createdAt: -1 }).limit(10).lean();

  if (campaigns.length === 0) {
    logger.info('No campaigns yet. Run "new" to create one.');
    return;
  }

  console.log(chalk.bold('\n── Recent Campaigns ──────────────────────────\n'));
  campaigns.forEach((c, i) => {
    const statusColor =
      c.status === 'completed' ? chalk.green :
      c.status === 'executing' ? chalk.blue :
      c.status === 'pending_approval' ? chalk.yellow :
      c.status === 'rejected' ? chalk.red :
      chalk.gray;

    console.log(
      `${chalk.gray(String(i + 1).padStart(2))}. ${statusColor(`[${c.status}]`.padEnd(20))} ` +
      `${chalk.white(c.goal.slice(0, 50).padEnd(52))} ` +
      `${chalk.cyan(`${c.stats.totalTargeted} targets`).padEnd(15)} ` +
      chalk.gray(new Date(c.createdAt).toLocaleDateString('en-IN'))
    );
  });
  console.log();
}

async function showStats() {
  const spinner = ora('Fetching stats...').start();
  const stats = await getCustomerStats();
  spinner.stop();

  console.log(chalk.bold('\n── Customer Database ─────────────────────────\n'));
  console.log(`  Total customers:    ${chalk.green(stats.total)}`);
  console.log(`  Avg spend:          ${chalk.yellow('₹' + stats.avgSpend.toLocaleString('en-IN'))}`);
  console.log(`\n  By segment:`);
  Object.entries(stats.bySegment).forEach(([seg, count]) => {
    console.log(`    ${seg.padEnd(12)} ${chalk.green(count)}`);
  });
  console.log(`\n  Dormant customers:`);
  console.log(`    Last 30 days:  ${chalk.red(stats.dormant30)}`);
  console.log(`    Last 60 days:  ${chalk.red(stats.dormant60)}`);
  console.log(`    Last 90 days:  ${chalk.red(stats.dormant90)}`);
  console.log();
}

async function reviewPending() {
  const campaigns = await Campaign.find({ status: 'pending_approval' }).sort({ createdAt: -1 });

  if (campaigns.length === 0) {
    logger.info('No campaigns pending approval.');
    return;
  }

  for (const campaign of campaigns) {
    printCampaignPreview(campaign);
    const action = await ask(`Approve campaign "${campaign.goal.slice(0, 40)}"? [y/n/r]: `);

    if (action.toLowerCase() === 'y') {
      campaign.status = 'approved';
      campaign.approvedBy = 'cli-user';
      await campaign.save();

      const worker = await startWorker();
      await enqueueCampaign(campaign._id.toString());
      await new Promise((r) => setTimeout(r, 2000));
      await worker.close();
      logger.success('Campaign approved and emails queued');
    } else if (action.toLowerCase() === 'r') {
      const reason = await ask('Rejection reason: ');
      campaign.status = 'rejected';
      campaign.rejectionReason = reason;
      await campaign.save();
      logger.info('Campaign rejected');
    } else {
      logger.info('Skipped');
    }
  }
}

async function mainMenu() {
  printBanner();
  await connectDB();

  while (true) {
    console.log(chalk.bold('What would you like to do?\n'));
    console.log(`  ${chalk.cyan('1')}  Create new campaign`);
    console.log(`  ${chalk.cyan('2')}  Review pending approvals`);
    console.log(`  ${chalk.cyan('3')}  List all campaigns`);
    console.log(`  ${chalk.cyan('4')}  View customer stats`);
    console.log(`  ${chalk.cyan('5')}  Exit\n`);

    const choice = await ask('Choice [1-5]: ');

    switch (choice) {
      case '1':
        await runNewCampaign();
        break;
      case '2':
        await reviewPending();
        break;
      case '3':
        await listCampaigns();
        break;
      case '4':
        await showStats();
        break;
      case '5':
        await closeQueue();
        await disconnectDB();
        rl.close();
        console.log(chalk.magenta('\nGoodbye!\n'));
        process.exit(0);
      default:
        logger.warn('Invalid choice');
    }
  }
}

mainMenu().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
