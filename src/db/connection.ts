import mongoose from 'mongoose';
import { config } from '../utils/config';

let isConnected = false;

export async function connectDB(): Promise<void> {
  if (isConnected) return;

  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });

  isConnected = true;
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message);
  });
}

export async function disconnectDB(): Promise<void> {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
}
