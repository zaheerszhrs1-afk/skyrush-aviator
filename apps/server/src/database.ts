import mongoose from "mongoose";
import { PlatformSettingsModel, PlatformStateModel } from "./models.js";

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error("MONGODB_URI is required. Add the MongoDB Atlas connection string in Railway Variables.");
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15_000,
    maxPoolSize: 20
  });

  const initialHouseBankroll = Math.max(0, Number(process.env.INITIAL_HOUSE_BANKROLL ?? 0) || 0);
  await Promise.all([
    PlatformSettingsModel.updateOne(
      { key: "global" },
      { $setOnInsert: { key: "global" } },
      { upsert: true }
    ),
    PlatformStateModel.updateOne(
      { key: "global" },
      { $setOnInsert: { key: "global", houseBankroll: initialHouseBankroll } },
      { upsert: true }
    )
  ]);

  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
