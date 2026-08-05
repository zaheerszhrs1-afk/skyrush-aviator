import * as crypto from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { Server, Socket } from "socket.io";
import mongoose from "mongoose";
import {
  AuthSessionModel,
  ContentCampaignModel,
  DepositRequestModel,
  FaqModel,
  NotificationCampaignModel,
  PasswordResetTokenModel,
  PlatformSettingsModel,
  SupportConversationModel,
  SupportMessageModel,
  UserModel,
  UserNotificationModel,
  UserReportModel,
  WithdrawalRequestModel,
  type AdminPermission
} from "./models.js";
import {
  createAuthSession,
  destroyAuthSession,
  hashPassword,
  isValidPhone,
  normalizePhone,
  publicUser,
  requireAdmin,
  requireAuth,
  verifyPassword,
  type AuthenticatedRequest,
  type AuthUser
} from "./auth.js";
import { sendAdminNotificationEmail, sendPasswordResetEmail } from "./mailer.js";

const clean = (value: unknown, max = 1000): string => String(value ?? "").trim().slice(0, max);
const bool = (value: unknown, fallback = false): boolean => typeof value === "boolean" ? value : fallback;
const safeUrl = (value: unknown, max = 700): string => {
  const candidate = clean(value, max);
  if (!candidate) return "";
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) ? candidate : "";
  } catch {
    return "";
  }
};
const asyncRoute = (handler: (request: any, response: Response, next: NextFunction) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction) => void handler(request, response, next).catch(next);

const ALL_PERMISSIONS: AdminPermission[] = [
  "OVERVIEW", "BETS", "BONUSES", "REFERRALS", "PAYMENT_METHODS", "USERS", "DEPOSITS", "WITHDRAWALS", "AUDIT", "SETTINGS",
  "SUPPORT", "CONTENT", "TEAM", "REPORTS", "FAQS", "NOTIFICATIONS", "GAME_CONTROL"
];

export interface GameControlAdapter {
  getAdminControlState(): { planeOverrideEnabled: boolean; overrideCrashMultiplier: number; phase: string; multiplier: number; hasActiveBets: boolean };
  updateAdminControl(input: { enabled?: boolean; crashMultiplier?: number; forceCrash?: boolean }): Promise<{ ok: boolean; message: string }>;
}

const passwordResetHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

async function deliverNotification(io: Server, campaignInput: any, senderId?: string): Promise<void> {
  const campaignId = campaignInput?._id ?? campaignInput;
  const campaign = await NotificationCampaignModel.findOneAndUpdate(
    { _id: campaignId, status: { $in: ["DRAFT", "SCHEDULED"] } },
    { $set: { status: "SENDING" } },
    { new: true }
  );
  if (!campaign) return;

  try {
    const users = campaign.targetType === "SELECTED"
      ? await UserModel.find({ _id: { $in: campaign.userIds }, role: "USER", status: "ACTIVE" }).select("_id gameNotifications").lean()
      : await UserModel.find({ role: "USER", status: "ACTIVE" }).select("_id gameNotifications").lean();

    const enabledUsers = users.filter((user: any) => user.gameNotifications !== false);
    if (enabledUsers.length > 0) {
      await UserNotificationModel.insertMany(enabledUsers.map((user: any) => ({
        campaignId: campaign._id,
        userId: user._id,
        title: campaign.title,
        body: campaign.body
      })), { ordered: false }).catch((error: any) => {
        if (error?.code !== 11000 && !Array.isArray(error?.writeErrors)) throw error;
      });
    }

    campaign.status = "SENT";
    campaign.sentAt = new Date();
    if (senderId && mongoose.Types.ObjectId.isValid(senderId)) campaign.sentBy = new mongoose.Types.ObjectId(senderId);
    await campaign.save();

    for (const user of enabledUsers) {
      io.to(`user:${String(user._id)}`).emit("notification:new", {
        id: String(campaign._id),
        title: campaign.title,
        body: campaign.body,
        createdAt: campaign.sentAt?.getTime() ?? Date.now()
      });
    }
  } catch (error) {
    await NotificationCampaignModel.updateOne(
      { _id: campaign._id, status: "SENDING" },
      { $set: { status: campaign.scheduledAt ? "SCHEDULED" : "DRAFT" } }
    ).catch(() => undefined);
    throw error;
  }
}

async function supportHistory(userId: string) {
  let conversation = await SupportConversationModel.findOne({ userId }).lean();
  if (!conversation) return { conversation: null, messages: [] };
  const messages = await SupportMessageModel.find({ conversationId: conversation._id })
    .sort({ createdAt: 1 })
    .limit(300)
    .populate("senderId", "name email role")
    .lean();
  return { conversation, messages };
}

export function registerPlatformFeatures(app: Express, io: Server, engine: GameControlAdapter): () => void {
  app.post("/api/admin/auth/login", asyncRoute(async (request: AuthenticatedRequest, response) => {
    const email = clean(request.body?.email, 160).toLowerCase();
    const password = String(request.body?.password ?? "");
    const user = await UserModel.findOne({ email, role: { $in: ["ADMIN", "SUB_ADMIN"] } }).select("+passwordHash");
    if (!user || !user.passwordHash || !(await verifyPassword(password, String(user.passwordHash)))) {
      response.status(401).json({ ok: false, message: "Invalid administrator email or password." });
      return;
    }
    if (user.status !== "ACTIVE") {
      response.status(403).json({ ok: false, message: "This administrator account is suspended." });
      return;
    }
    user.lastLoginAt = new Date();
    await user.save();
    if (request.sessionTokenHash) await AuthSessionModel.deleteOne({ tokenHash: request.sessionTokenHash });
    await createAuthSession(String(user._id), request, response);
    response.json({ ok: true, user: publicUser(user) });
  }));

  app.post("/api/admin/auth/logout", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    await destroyAuthSession(request, response);
    response.json({ ok: true });
  }));

  app.post("/api/auth/forgot-password", asyncRoute(async (request, response) => {
    const email = clean(request.body?.email, 160).toLowerCase();
    const user = await UserModel.findOne({ email, role: "USER", status: "ACTIVE" });
    if (user) {
      const recentlyRequested = await PasswordResetTokenModel.exists({
        userId: user._id,
        usedAt: { $exists: false },
        createdAt: { $gt: new Date(Date.now() - 60_000) }
      });
      if (!recentlyRequested) {
        await PasswordResetTokenModel.deleteMany({ userId: user._id, usedAt: { $exists: false } });
        const token = crypto.randomBytes(36).toString("base64url");
        await PasswordResetTokenModel.create({
          tokenHash: passwordResetHash(token),
          userId: user._id,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000)
        });
        const appUrl = (process.env.PUBLIC_APP_URL?.trim() || `${request.protocol}://${request.get("host")}`).replace(/\/$/, "");
        await sendPasswordResetEmail({
          email: user.email,
          name: user.name,
          resetUrl: `${appUrl}/reset-password?token=${encodeURIComponent(token)}`
        }).catch((error) => {
          console.error(`[password-reset-email] user=${String(user._id)}`, error);
        });
      }
    }
    response.json({ ok: true, message: "If that email exists, a password reset link has been sent." });
  }));

  app.post("/api/auth/reset-password", asyncRoute(async (request, response) => {
    const token = clean(request.body?.token, 300);
    const password = String(request.body?.password ?? "");
    if (password.length < 8) {
      response.status(400).json({ ok: false, message: "Password must contain at least 8 characters." });
      return;
    }
    const record = await PasswordResetTokenModel.findOne({
      tokenHash: passwordResetHash(token),
      expiresAt: { $gt: new Date() },
      usedAt: { $exists: false }
    });
    if (!record) {
      response.status(400).json({ ok: false, message: "This password reset link is invalid or expired." });
      return;
    }
    const user = await UserModel.findById(record.userId).select("+passwordHash");
    if (!user || user.role !== "USER") {
      response.status(400).json({ ok: false, message: "This password reset link is invalid." });
      return;
    }
    user.passwordHash = await hashPassword(password);
    user.authProvider = user.authProvider === "GOOGLE" ? "HYBRID" : "PASSWORD";
    await user.save();
    record.usedAt = new Date();
    await record.save();
    await AuthSessionModel.deleteMany({ userId: user._id });
    response.json({ ok: true, message: "Password changed successfully. Sign in with your new password." });
  }));

  app.get("/api/profile", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const user = await UserModel.findById(request.authUser!.id).lean();
    if (!user) {
      response.status(404).json({ ok: false, message: "User account not found." });
      return;
    }
    response.json({ ok: true, user: publicUser(user) });
  }));

  app.patch("/api/profile", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const update = {
      name: clean(request.body?.name, 80),
      phone: normalizePhone(request.body?.phone),
      country: clean(request.body?.country, 80) || "Pakistan",
      language: clean(request.body?.language, 40) || "English",
      timezone: clean(request.body?.timezone, 80) || "Asia/Karachi",
      bio: clean(request.body?.bio, 240),
      avatarUrl: safeUrl(request.body?.avatarUrl, 500),
      marketingOptIn: bool(request.body?.marketingOptIn, true),
      gameNotifications: bool(request.body?.gameNotifications, true),
      supportNotifications: bool(request.body?.supportNotifications, true)
    };
    if (update.name.length < 2) {
      response.status(400).json({ ok: false, message: "Name must contain at least 2 characters." });
      return;
    }
    if (update.phone && !isValidPhone(update.phone)) {
      response.status(400).json({ ok: false, message: "Enter a valid phone number with country code." });
      return;
    }
    if (update.phone && await UserModel.exists({ _id: { $ne: request.authUser!.id }, phone: update.phone })) {
      response.status(409).json({ ok: false, message: "An account already exists with this phone number." });
      return;
    }
    const user = await UserModel.findByIdAndUpdate(request.authUser!.id, { $set: update }, { new: true });
    response.json({ ok: true, user: publicUser(user), message: "Profile updated." });
  }));

  app.post("/api/profile/change-password", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const currentPassword = String(request.body?.currentPassword ?? "");
    const newPassword = String(request.body?.newPassword ?? "");
    if (newPassword.length < 8) {
      response.status(400).json({ ok: false, message: "New password must contain at least 8 characters." });
      return;
    }
    const user = await UserModel.findById(request.authUser!.id).select("+passwordHash");
    if (!user) throw new Error("User account not found.");
    if (user.passwordHash && !(await verifyPassword(currentPassword, String(user.passwordHash)))) {
      response.status(400).json({ ok: false, message: "Current password is incorrect." });
      return;
    }
    user.passwordHash = await hashPassword(newPassword);
    user.authProvider = user.authProvider === "GOOGLE" ? "HYBRID" : "PASSWORD";
    await user.save();
    await AuthSessionModel.deleteMany({ userId: user._id, tokenHash: { $ne: request.sessionTokenHash } });
    response.json({ ok: true, message: "Password updated. Other sessions were signed out." });
  }));

  app.get("/api/profile/sessions", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const sessions = await AuthSessionModel.find({ userId: request.authUser!.id, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 }).lean();
    response.json({ ok: true, sessions: sessions.map((item: any) => ({
      id: String(item._id), userAgent: item.userAgent, ip: item.ip, createdAt: item.createdAt,
      current: item.tokenHash === request.sessionTokenHash
    })) });
  }));

  app.delete("/api/profile/sessions/:id", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    await AuthSessionModel.deleteOne({ _id: request.params.id, userId: request.authUser!.id });
    response.json({ ok: true });
  }));

  app.get("/api/public-config", asyncRoute(async (_request, response) => {
    const settings = await PlatformSettingsModel.findOne({ key: "global" }).lean();
    response.json({
      ok: true,
      whatsappNumber: clean(process.env.WHATSAPP_NUMBER || (settings as any)?.whatsappNumber, 32),
      whatsappMessage: clean(process.env.WHATSAPP_MESSAGE || (settings as any)?.whatsappMessage, 250)
    });
  }));

  app.get("/api/content/active", asyncRoute(async (request, response) => {
    const requestedPlacement = String(request.query.placement);
    const placement: "LOGIN" | "GAME" | "BOTH" = ["LOGIN", "GAME", "BOTH"].includes(requestedPlacement)
      ? requestedPlacement as "LOGIN" | "GAME" | "BOTH" : "GAME";
    const now = new Date();
    const items = await ContentCampaignModel.find({
      enabled: true,
      placement: { $in: [placement, "BOTH"] },
      $and: [
        { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] }
      ]
    }).sort({ priority: -1, createdAt: -1 }).lean();
    response.json({ ok: true, items });
  }));

  app.get("/api/faqs", asyncRoute(async (_request, response) => {
    const faqs = await FaqModel.find({ enabled: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    response.json({ ok: true, faqs });
  }));

  app.get("/api/reports/me", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const reports = await UserReportModel.find({ userId: request.authUser!.id }).sort({ createdAt: -1 }).lean();
    response.json({ ok: true, reports });
  }));

  app.post("/api/reports", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const requestedCategory = String(request.body?.category);
    const category: "ACCOUNT" | "PAYMENT" | "GAME" | "SECURITY" | "OTHER" = ["ACCOUNT", "PAYMENT", "GAME", "SECURITY", "OTHER"].includes(requestedCategory)
      ? requestedCategory as "ACCOUNT" | "PAYMENT" | "GAME" | "SECURITY" | "OTHER" : "OTHER";
    const subject = clean(request.body?.subject, 160);
    const description = clean(request.body?.description, 3000);
    if (!subject || description.length < 10) {
      response.status(400).json({ ok: false, message: "Subject and a detailed description are required." });
      return;
    }
    const report = await UserReportModel.create({ userId: request.authUser!.id, category, subject, description });
    response.status(201).json({ ok: true, report, message: "Report submitted to support." });
  }));

  app.get("/api/notifications", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const notifications = await UserNotificationModel.find({ userId: request.authUser!.id }).sort({ createdAt: -1 }).limit(100).lean();
    response.json({ ok: true, notifications, unread: notifications.filter((item: any) => !item.readAt).length });
  }));

  app.patch("/api/notifications/:id/read", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    await UserNotificationModel.updateOne({ _id: request.params.id, userId: request.authUser!.id }, { $set: { readAt: new Date() } });
    response.json({ ok: true });
  }));

  app.patch("/api/notifications/read-all", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    await UserNotificationModel.updateMany({ userId: request.authUser!.id, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
    response.json({ ok: true });
  }));

  app.get("/api/support/me", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
    response.json({ ok: true, ...(await supportHistory(request.authUser!.id)) });
  }));

  app.get("/api/admin/support", requireAdmin, asyncRoute(async (_request, response) => {
    const conversations = await SupportConversationModel.find({})
      .sort({ lastMessageAt: -1 })
      .populate("userId", "name email avatarUrl status")
      .populate("assignedAdminId", "name email")
      .lean();
    response.json({ ok: true, conversations });
  }));

  app.get("/api/admin/support/:userId", requireAdmin, asyncRoute(async (request, response) => {
    response.json({ ok: true, ...(await supportHistory(request.params.userId)) });
  }));

  app.patch("/api/admin/support/:id", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const status = request.body?.status === "CLOSED" ? "CLOSED" : "OPEN";
    const conversation = await SupportConversationModel.findByIdAndUpdate(request.params.id, {
      $set: { status, assignedAdminId: request.authUser!.id, unreadForAdmin: 0 }
    }, { new: true });
    response.json({ ok: true, conversation });
  }));

  app.get("/api/admin/content", requireAdmin, asyncRoute(async (_request, response) => {
    const items = await ContentCampaignModel.find({}).sort({ createdAt: -1 }).lean();
    response.json({ ok: true, items });
  }));

  app.post("/api/admin/content", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const title = clean(request.body?.title, 120);
    if (!title) { response.status(400).json({ ok: false, message: "Content title is required." }); return; }
    const startsAt = request.body?.startsAt ? new Date(request.body.startsAt) : undefined;
    const endsAt = request.body?.endsAt ? new Date(request.body.endsAt) : undefined;
    if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) {
      response.status(400).json({ ok: false, message: "Enter valid campaign dates." }); return;
    }
    if (startsAt && endsAt && endsAt <= startsAt) {
      response.status(400).json({ ok: false, message: "Campaign end time must be after its start time." }); return;
    }
    const item = await ContentCampaignModel.create({
      type: ["POPUP", "BANNER", "ANNOUNCEMENT", "NEWS"].includes(String(request.body?.type)) ? request.body.type : "ANNOUNCEMENT",
      title, body: clean(request.body?.body, 2000),
      imageUrl: safeUrl(request.body?.imageUrl, 700), linkUrl: safeUrl(request.body?.linkUrl, 700),
      imageData: clean(request.body?.imageData, 850_000),
      linkLabel: clean(request.body?.linkLabel, 60) || "Learn more",
      linkTarget: clean(request.body?.linkTarget, 80), design: request.body?.design ?? {},
      placement: ["LOGIN", "GAME", "BOTH"].includes(String(request.body?.placement)) ? request.body.placement : "GAME",
      enabled: request.body?.enabled !== false, dismissible: request.body?.dismissible !== false,
      priority: Math.min(1000, Math.max(-1000, Number(request.body?.priority ?? 0) || 0)), startsAt,
      endsAt, createdBy: request.authUser!.id, updatedBy: request.authUser!.id
    });
    response.status(201).json({ ok: true, item });
  }));

  app.patch("/api/admin/content/:id", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const body = request.body ?? {};
    const update: Record<string, unknown> = { updatedBy: request.authUser!.id };
    if (Object.prototype.hasOwnProperty.call(body, "type")) {
      update.type = ["POPUP", "BANNER", "ANNOUNCEMENT", "NEWS"].includes(String(body.type)) ? body.type : "ANNOUNCEMENT";
    }
    if (Object.prototype.hasOwnProperty.call(body, "title")) {
      const title = clean(body.title, 120);
      if (!title) { response.status(400).json({ ok: false, message: "Content title is required." }); return; }
      update.title = title;
    }
    if (Object.prototype.hasOwnProperty.call(body, "body")) update.body = clean(body.body, 2000);
    if (Object.prototype.hasOwnProperty.call(body, "imageUrl")) update.imageUrl = safeUrl(body.imageUrl, 700);
    if (Object.prototype.hasOwnProperty.call(body, "imageData")) update.imageData = clean(body.imageData, 850_000);
    if (Object.prototype.hasOwnProperty.call(body, "linkUrl")) update.linkUrl = safeUrl(body.linkUrl, 700);
    if (Object.prototype.hasOwnProperty.call(body, "linkLabel")) update.linkLabel = clean(body.linkLabel, 60) || "Learn more";
    if (Object.prototype.hasOwnProperty.call(body, "linkTarget")) update.linkTarget = clean(body.linkTarget, 80);
    if (Object.prototype.hasOwnProperty.call(body, "design")) update.design = body.design ?? {};
    if (Object.prototype.hasOwnProperty.call(body, "placement")) {
      update.placement = ["LOGIN", "GAME", "BOTH"].includes(String(body.placement)) ? body.placement : "GAME";
    }
    if (Object.prototype.hasOwnProperty.call(body, "enabled")) update.enabled = body.enabled === true;
    if (Object.prototype.hasOwnProperty.call(body, "dismissible")) update.dismissible = body.dismissible !== false;
    if (Object.prototype.hasOwnProperty.call(body, "priority")) update.priority = Math.min(1000, Math.max(-1000, Number(body.priority) || 0));

    const startsAt = Object.prototype.hasOwnProperty.call(body, "startsAt")
      ? (body.startsAt ? new Date(body.startsAt) : null)
      : undefined;
    const endsAt = Object.prototype.hasOwnProperty.call(body, "endsAt")
      ? (body.endsAt ? new Date(body.endsAt) : null)
      : undefined;
    if ((startsAt instanceof Date && Number.isNaN(startsAt.getTime())) || (endsAt instanceof Date && Number.isNaN(endsAt.getTime()))) {
      response.status(400).json({ ok: false, message: "Enter valid campaign dates." }); return;
    }
    if (startsAt !== undefined) update.startsAt = startsAt;
    if (endsAt !== undefined) update.endsAt = endsAt;
    const existing = await ContentCampaignModel.findById(request.params.id).select("startsAt endsAt").lean();
    if (!existing) { response.status(404).json({ ok: false, message: "Content campaign was not found." }); return; }
    const effectiveStart = startsAt === undefined ? (existing as any).startsAt : startsAt;
    const effectiveEnd = endsAt === undefined ? (existing as any).endsAt : endsAt;
    if (effectiveStart && effectiveEnd && new Date(effectiveEnd).getTime() <= new Date(effectiveStart).getTime()) {
      response.status(400).json({ ok: false, message: "Campaign end time must be after its start time." }); return;
    }
    const item = await ContentCampaignModel.findByIdAndUpdate(request.params.id, { $set: update }, { new: true, runValidators: true });
    response.json({ ok: true, item });
  }));

  app.delete("/api/admin/content/:id", requireAdmin, asyncRoute(async (request, response) => {
    await ContentCampaignModel.deleteOne({ _id: request.params.id });
    response.json({ ok: true });
  }));

  app.get("/api/admin/faqs", requireAdmin, asyncRoute(async (_request, response) => {
    response.json({ ok: true, faqs: await FaqModel.find({}).sort({ sortOrder: 1, createdAt: 1 }).lean() });
  }));

  app.post("/api/admin/faqs", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const question = clean(request.body?.question, 240);
    const answer = clean(request.body?.answer, 4000);
    if (!question || !answer) { response.status(400).json({ ok: false, message: "FAQ question and answer are required." }); return; }
    const faq = await FaqModel.create({
      question, answer,
      category: clean(request.body?.category, 80) || "General", enabled: request.body?.enabled !== false,
      sortOrder: Number(request.body?.sortOrder ?? 0) || 0, createdBy: request.authUser!.id, updatedBy: request.authUser!.id
    });
    response.status(201).json({ ok: true, faq });
  }));

  app.patch("/api/admin/faqs/:id", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const body = request.body ?? {};
    const update: Record<string, unknown> = { updatedBy: request.authUser!.id };
    if (Object.prototype.hasOwnProperty.call(body, "question")) {
      const question = clean(body.question, 240);
      if (!question) { response.status(400).json({ ok: false, message: "FAQ question is required." }); return; }
      update.question = question;
    }
    if (Object.prototype.hasOwnProperty.call(body, "answer")) {
      const answer = clean(body.answer, 4000);
      if (!answer) { response.status(400).json({ ok: false, message: "FAQ answer is required." }); return; }
      update.answer = answer;
    }
    if (Object.prototype.hasOwnProperty.call(body, "category")) update.category = clean(body.category, 80) || "General";
    if (Object.prototype.hasOwnProperty.call(body, "enabled")) update.enabled = body.enabled === true;
    if (Object.prototype.hasOwnProperty.call(body, "sortOrder")) update.sortOrder = Number(body.sortOrder) || 0;
    const faq = await FaqModel.findByIdAndUpdate(request.params.id, { $set: update }, { new: true, runValidators: true });
    if (!faq) { response.status(404).json({ ok: false, message: "FAQ was not found." }); return; }
    response.json({ ok: true, faq });
  }));

  app.delete("/api/admin/faqs/:id", requireAdmin, asyncRoute(async (request, response) => {
    await FaqModel.deleteOne({ _id: request.params.id });
    response.json({ ok: true });
  }));

  app.get("/api/admin/reports", requireAdmin, asyncRoute(async (request, response) => {
    const requestedStatus = clean(request.query.status, 30);
    const filter = requestedStatus && requestedStatus !== "ALL"
      ? { status: requestedStatus as "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED" } : {};
    const reports = await UserReportModel.find(filter).sort({ createdAt: -1 }).populate("userId", "name email avatarUrl status").populate("reviewedBy", "name email").lean();
    response.json({ ok: true, reports });
  }));

  app.patch("/api/admin/reports/:id", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const status = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"].includes(String(request.body?.status)) ? request.body.status : "IN_REVIEW";
    const report = await UserReportModel.findByIdAndUpdate(request.params.id, { $set: {
      status, adminNote: clean(request.body?.adminNote, 2000), reviewedBy: request.authUser!.id, reviewedAt: new Date()
    } }, { new: true });
    response.json({ ok: true, report });
  }));

  app.get("/api/admin/subadmins", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
    if (request.authUser!.role !== "ADMIN") { response.status(403).json({ ok: false, message: "Only the primary administrator can manage staff." }); return; }
    const users = await UserModel.find({ role: "SUB_ADMIN" }).sort({ createdAt: -1 }).lean();
    response.json({ ok: true, users: users.map(publicUser), permissions: ALL_PERMISSIONS });
  }));

  app.post("/api/admin/subadmins", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
    if (request.authUser!.role !== "ADMIN") { response.status(403).json({ ok: false, message: "Only the primary administrator can create staff." }); return; }
    const email = clean(request.body?.email, 160).toLowerCase();
    const name = clean(request.body?.name, 80);
    const password = String(request.body?.password ?? "");
    const permissions = Array.isArray(request.body?.permissions)
      ? request.body.permissions.filter((item: unknown) => ALL_PERMISSIONS.includes(item as AdminPermission)) : [];
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10) {
      response.status(400).json({ ok: false, message: "Name, valid email and a password of at least 10 characters are required." }); return;
    }
    if (await UserModel.exists({ email })) { response.status(409).json({ ok: false, message: "An account already exists with this email." }); return; }
    const user = await UserModel.create({
      name, email, passwordHash: await hashPassword(password), authProvider: "PASSWORD", role: "SUB_ADMIN",
      status: "ACTIVE", adminPermissions: permissions, balanceMinor: 0, withdrawalLockedMinor: 0,
      bettingLockedMinor: 0, pendingRewardsMinor: 0, balance: 0, lockedBalance: 0
    });
    response.status(201).json({ ok: true, user: publicUser(user) });
  }));

  app.patch("/api/admin/subadmins/:id", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
    if (request.authUser!.role !== "ADMIN") { response.status(403).json({ ok: false, message: "Only the primary administrator can manage staff." }); return; }
    const update: Record<string, unknown> = {};
    if (request.body?.name) update.name = clean(request.body.name, 80);
    if (["ACTIVE", "SUSPENDED"].includes(String(request.body?.status))) update.status = request.body.status;
    if (Array.isArray(request.body?.permissions)) update.adminPermissions = request.body.permissions.filter((item: unknown) => ALL_PERMISSIONS.includes(item as AdminPermission));
    const requestedPassword = String(request.body?.password ?? "");
    if (requestedPassword && requestedPassword.length < 10) { response.status(400).json({ ok: false, message: "New staff password must contain at least 10 characters." }); return; }
    if (requestedPassword) update.passwordHash = await hashPassword(requestedPassword);
    const user = await UserModel.findOneAndUpdate({ _id: request.params.id, role: "SUB_ADMIN" }, { $set: update }, { new: true });
    if (!user) { response.status(404).json({ ok: false, message: "Sub administrator was not found." }); return; }
    if (update.passwordHash || update.status === "SUSPENDED") await AuthSessionModel.deleteMany({ userId: request.params.id });
    response.json({ ok: true, user: publicUser(user) });
  }));

  app.get("/api/admin/notifications", requireAdmin, asyncRoute(async (_request, response) => {
    const [campaigns, recipients] = await Promise.all([
      NotificationCampaignModel.find({}).sort({ createdAt: -1 }).populate("createdBy", "name email").lean(),
      UserModel.find({ role: "USER", status: "ACTIVE" }).sort({ name: 1 }).select("name email avatarUrl").lean()
    ]);
    response.json({
      ok: true,
      campaigns,
      recipients: recipients.map((user: any) => ({ id: String(user._id), name: user.name, email: user.email, avatarUrl: user.avatarUrl ?? "" }))
    });
  }));

  app.get("/api/admin/reminders", requireAdmin, asyncRoute(async (_request, response) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [pendingDeposits, pendingWithdrawals, openReports, supportUnread, newUsers] = await Promise.all([
      DepositRequestModel.countDocuments({ status: "PENDING" }),
      WithdrawalRequestModel.countDocuments({ status: "PENDING" }),
      UserReportModel.countDocuments({ status: { $in: ["OPEN", "IN_REVIEW"] } }),
      SupportConversationModel.aggregate([
        { $match: { unreadForAdmin: { $gt: 0 } } },
        { $group: { _id: null, count: { $sum: "$unreadForAdmin" } } }
      ]),
      UserModel.countDocuments({ role: "USER", createdAt: { $gte: today } })
    ]);
    const reminders = [
      { id: "pending-deposits", tab: "DEPOSITS", count: pendingDeposits, title: "Deposits need review", body: `${pendingDeposits} deposit request${pendingDeposits === 1 ? "" : "s"} are waiting for a decision.` },
      { id: "pending-withdrawals", tab: "WITHDRAWALS", count: pendingWithdrawals, title: "Withdrawals need review", body: `${pendingWithdrawals} withdrawal request${pendingWithdrawals === 1 ? "" : "s"} are waiting for processing.` },
      { id: "open-reports", tab: "REPORTS", count: openReports, title: "User reports are open", body: `${openReports} report${openReports === 1 ? "" : "s"} still need admin attention.` },
      { id: "unread-support", tab: "SUPPORT", count: Number(supportUnread[0]?.count ?? 0), title: "Unread support messages", body: `${Number(supportUnread[0]?.count ?? 0)} support message${Number(supportUnread[0]?.count ?? 0) === 1 ? "" : "s"} are waiting for a reply.` },
      { id: "new-users", tab: "USERS", count: newUsers, title: "New users today", body: `${newUsers} new user${newUsers === 1 ? "" : "s"} joined today.` }
    ].filter((item) => item.count > 0);
    response.json({ ok: true, reminders });
  }));

  app.post("/api/admin/notifications", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const title = clean(request.body?.title, 120);
    const body = clean(request.body?.body, 1200);
    const targetType = request.body?.targetType === "SELECTED" ? "SELECTED" : "ALL";
    const userIds = Array.isArray(request.body?.userIds)
      ? request.body.userIds.filter((id: unknown) => mongoose.Types.ObjectId.isValid(String(id)))
      : [];
    const sendNow = request.body?.sendNow !== false;
    const scheduledAt = request.body?.scheduledAt ? new Date(request.body.scheduledAt) : null;
    if (!title || !body) { response.status(400).json({ ok: false, message: "Notification title and message are required." }); return; }
    if (targetType === "SELECTED" && userIds.length === 0) { response.status(400).json({ ok: false, message: "Select at least one recipient." }); return; }
    if (!sendNow && (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now())) {
      response.status(400).json({ ok: false, message: "Choose a valid future schedule time." }); return;
    }
    const campaign = await NotificationCampaignModel.create({
      title, body, targetType, userIds,
      status: sendNow ? "DRAFT" : "SCHEDULED", scheduledAt: sendNow ? undefined : scheduledAt, createdBy: request.authUser!.id
    });
    if (sendNow) await deliverNotification(io, campaign, request.authUser!.id);
    response.status(201).json({ ok: true, campaign: await NotificationCampaignModel.findById(campaign._id).lean() });
  }));

  app.post("/api/admin/notifications/email", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
    const subject = clean(request.body?.subject, 160);
    const body = clean(request.body?.body, 4000);
    const targetType = request.body?.targetType === "SELECTED" ? "SELECTED" : "ALL";
    const userIds = Array.isArray(request.body?.userIds)
      ? request.body.userIds.filter((id: unknown) => mongoose.Types.ObjectId.isValid(String(id)))
      : [];
    if (!subject || !body) { response.status(400).json({ ok: false, message: "Email subject and message are required." }); return; }
    if (targetType === "SELECTED" && userIds.length === 0) { response.status(400).json({ ok: false, message: "Select at least one email recipient." }); return; }

    const filter = targetType === "SELECTED"
      ? { _id: { $in: userIds }, role: "USER" as const, status: "ACTIVE" as const }
      : { role: "USER" as const, status: "ACTIVE" as const };
    const recipients = await UserModel.find(filter).select("name email").lean();
    if (recipients.length === 0) { response.status(400).json({ ok: false, message: "No active email recipients were found." }); return; }

    let sent = 0;
    let failed = 0;
    for (let index = 0; index < recipients.length; index += 25) {
      const batch = recipients.slice(index, index + 25);
      await Promise.all(batch.map(async (recipient: any) => {
        try {
          await sendAdminNotificationEmail({ email: recipient.email, name: recipient.name, subject, body });
          sent += 1;
        } catch {
          failed += 1;
        }
      }));
    }
    if (sent === 0) { response.status(502).json({ ok: false, message: "No emails were sent. Check the SMTP configuration." }); return; }
    response.json({ ok: true, sent, failed, message: failed > 0 ? `Sent ${sent} email${sent === 1 ? "" : "s"}; ${failed} failed.` : `Sent ${sent} email${sent === 1 ? "" : "s"}.` });
  }));

  app.patch("/api/admin/notifications/:id/cancel", requireAdmin, asyncRoute(async (request, response) => {
    const campaign = await NotificationCampaignModel.findOneAndUpdate({ _id: request.params.id, status: { $in: ["DRAFT", "SCHEDULED"] } }, { $set: { status: "CANCELLED" } }, { new: true });
    response.json({ ok: true, campaign });
  }));

  app.get("/api/admin/game-control", requireAdmin, asyncRoute(async (_request, response) => {
    response.json({ ok: true, control: engine.getAdminControlState() });
  }));

  app.patch("/api/admin/game-control", requireAdmin, asyncRoute(async (request, response) => {
    const result = await engine.updateAdminControl({
      enabled: typeof request.body?.enabled === "boolean" ? request.body.enabled : undefined,
      crashMultiplier: Number.isFinite(Number(request.body?.crashMultiplier)) ? Number(request.body.crashMultiplier) : undefined,
      forceCrash: request.body?.forceCrash === true
    });
    response.status(result.ok ? 200 : 409).json(result);
  }));

  io.on("connection", (socket: Socket) => {
    const authUser = socket.data.user as AuthUser | undefined;
    if (!authUser) return;
    socket.join(`user:${authUser.id}`);
    if (["ADMIN", "SUB_ADMIN"].includes(authUser.role)) socket.join("admins");

    socket.on("support:load", async (payload: { userId?: string } | undefined, acknowledge?: (result: unknown) => void) => {
      try {
        const requestedUserId = ["ADMIN", "SUB_ADMIN"].includes(authUser.role) && payload?.userId ? String(payload.userId) : authUser.id;
        if (authUser.role === "SUB_ADMIN" && !authUser.adminPermissions.includes("SUPPORT")) throw new Error("Support access is not permitted.");
        const result = await supportHistory(requestedUserId);
        if (result.conversation) {
          await SupportConversationModel.updateOne({ _id: result.conversation._id }, {
            $set: authUser.role === "USER" ? { unreadForUser: 0 } : { unreadForAdmin: 0 }
          });
        }
        acknowledge?.({ ok: true, ...result });
      } catch (error) { acknowledge?.({ ok: false, message: error instanceof Error ? error.message : "Unable to load support chat." }); }
    });

    socket.on("support:send", async (payload: { userId?: string; message?: string; subject?: string }, acknowledge?: (result: unknown) => void) => {
      try {
        const message = clean(payload?.message, 1200);
        if (!message) throw new Error("Message is required.");
        const isAdmin = ["ADMIN", "SUB_ADMIN"].includes(authUser.role);
        if (authUser.role === "SUB_ADMIN" && !authUser.adminPermissions.includes("SUPPORT")) throw new Error("Support access is not permitted.");
        const targetUserId = isAdmin ? String(payload?.userId ?? "") : authUser.id;
        if (!mongoose.Types.ObjectId.isValid(targetUserId)) throw new Error("Select a valid support conversation.");
        const user = await UserModel.findOne({ _id: targetUserId, role: "USER" }).lean();
        if (!user) throw new Error("User account was not found.");
        const conversation = await SupportConversationModel.findOneAndUpdate(
          { userId: targetUserId },
          {
            $set: { status: "OPEN", lastMessageAt: new Date(), ...(isAdmin ? { assignedAdminId: authUser.id } : {}) },
            $setOnInsert: { subject: clean(payload?.subject, 120) || "General support" },
            $inc: isAdmin ? { unreadForUser: 1 } : { unreadForAdmin: 1 }
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        const item = await SupportMessageModel.create({
          conversationId: conversation._id, senderId: authUser.id, senderRole: authUser.role, message
        });
        const event = { id: String(item._id), conversationId: String(conversation._id), userId: targetUserId, senderId: authUser.id, senderRole: authUser.role, senderName: authUser.name, message, createdAt: item.createdAt.getTime() };
        io.to(`user:${targetUserId}`).emit("support:new", event);
        io.to("admins").emit("support:new", event);
        io.to("admins").emit("support:updated", { conversationId: String(conversation._id), userId: targetUserId, message, createdAt: event.createdAt });
        acknowledge?.({ ok: true, message: event, conversation });
      } catch (error) { acknowledge?.({ ok: false, message: error instanceof Error ? error.message : "Unable to send message." }); }
    });
  });

  const scheduler = setInterval(() => {
    void NotificationCampaignModel.find({ status: "SCHEDULED", scheduledAt: { $lte: new Date() } })
      .limit(20)
      .then((campaigns) => Promise.all(campaigns.map((campaign: any) => deliverNotification(io, campaign, String(campaign.createdBy ?? "")))))
      .catch((error) => console.error("[notification-scheduler]", error));
  }, 20_000);

  return () => clearInterval(scheduler);
}
