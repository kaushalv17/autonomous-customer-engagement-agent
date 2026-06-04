import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

export const config = {
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/campaignmind',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'CampaignMind <noreply@campaignmind.dev>',
  },
};
