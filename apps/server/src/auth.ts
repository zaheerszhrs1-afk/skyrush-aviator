import * as crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { promisify } from "node:util";
import { AuthSessionModel, UserModel, type AdminPermission, type AuthProvider, type UserRole } from "./models.js";
import { fromMinor, minorFromDocument } from "./money.js";

const scryptAsync = promisify(crypto.scrypt);
const SESSION_COOKIE = "b9t9_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizePhone(value: unknown): string {
  let digits = String(value ?? "").trim().slice(0, 40).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = `92${digits.slice(1)}`;
  return digits ? `+${digits}` : "";
}

export function isValidPhone(value: string): boolean {
  return /^\+\d{8,15}$/.test(value);
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "ACTIVE" | "SUSPENDED";
  balance: number;
  lockedBalance: number;
  bettingLockedBalance: number;
  pendingRewards: number;
  wagerRequirementRemaining: number;
  wagerRequirementTarget: number;
  wagerRequirementCompleted: number;
  totalBalance: number;
  authProvider: AuthProvider;
  avatarUrl: string;
  phone: string;
  country: string;
  language: string;
  timezone: string;
  bio: string;
  marketingOptIn: boolean;
  gameNotifications: boolean;
  supportNotifications: boolean;
  adminPermissions: AdminPermission[];
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  sessionTokenHash?: string;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return header.split(";").reduce<Record<string, string>>((cookies, item) => {
    const separator = item.indexOf("=");
    if (separator < 0) return cookies;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

export function publicUser(document: any): AuthUser {
  const balanceMinor = minorFromDocument(document, "balanceMinor", "balance");
  const withdrawalLockedMinor = minorFromDocument(document, "withdrawalLockedMinor", "lockedBalance");
  const bettingLockedMinor = Number.isSafeInteger(Number(document?.bettingLockedMinor))
    ? Number(document.bettingLockedMinor)
    : 0;
  const pendingRewardsMinor = Number.isSafeInteger(Number(document?.pendingRewardsMinor))
    ? Number(document.pendingRewardsMinor)
    : 0;
  const wagerRequirementMinor = Number.isSafeInteger(Number(document?.wagerRequirementMinor))
    ? Number(document.wagerRequirementMinor)
    : 0;
  const wagerTargetMinor = Number.isSafeInteger(Number(document?.wagerTargetMinor))
    ? Math.max(wagerRequirementMinor, Number(document.wagerTargetMinor))
    : wagerRequirementMinor;
  const wagerCompletedMinor = Number.isSafeInteger(Number(document?.wagerCompletedMinor))
    ? Math.min(wagerTargetMinor, Math.max(0, Number(document.wagerCompletedMinor)))
    : Math.max(0, wagerTargetMinor - wagerRequirementMinor);
  return {
    id: String(document._id),
    name: String(document.name),
    email: String(document.email),
    role: document.role as UserRole,
    status: document.status as "ACTIVE" | "SUSPENDED",
    balance: fromMinor(balanceMinor),
    lockedBalance: fromMinor(withdrawalLockedMinor),
    bettingLockedBalance: fromMinor(bettingLockedMinor),
    pendingRewards: fromMinor(pendingRewardsMinor),
    wagerRequirementRemaining: fromMinor(wagerRequirementMinor),
    wagerRequirementTarget: fromMinor(wagerTargetMinor),
    wagerRequirementCompleted: fromMinor(wagerCompletedMinor),
    totalBalance: fromMinor(balanceMinor + withdrawalLockedMinor + bettingLockedMinor + pendingRewardsMinor),
    authProvider: (document.authProvider ?? "PASSWORD") as AuthProvider,
    avatarUrl: String(document.avatarUrl ?? ""),
    phone: String(document.phone ?? ""),
    country: String(document.country ?? "Pakistan"),
    language: String(document.language ?? "English"),
    timezone: String(document.timezone ?? "Asia/Karachi"),
    bio: String(document.bio ?? ""),
    marketingOptIn: document.marketingOptIn !== false,
    gameNotifications: document.gameNotifications !== false,
    supportNotifications: document.supportNotifications !== false,
    adminPermissions: Array.isArray(document.adminPermissions) ? document.adminPermissions as AdminPermission[] : []
  };
}

export async function createAuthSession(userId: string, request: Request, response: Response): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MS);

  await AuthSessionModel.create({
    tokenHash,
    userId,
    expiresAt,
    userAgent: String(request.headers["user-agent"] ?? "").slice(0, 300),
    ip: request.ip
  });

  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MS,
    path: "/"
  });
}

export async function destroyAuthSession(request: AuthenticatedRequest, response: Response): Promise<void> {
  if (request.sessionTokenHash) {
    await AuthSessionModel.deleteOne({ tokenHash: request.sessionTokenHash });
  }
  response.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function resolveAuthUserFromCookie(cookieHeader: string | undefined): Promise<AuthUser | null> {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = await AuthSessionModel.findOne({ tokenHash, expiresAt: { $gt: new Date() } }).lean();
  if (!session) return null;
  const user = await UserModel.findById(session.userId).lean();
  if (!user || user.status !== "ACTIVE") return null;
  return publicUser(user);
}

export async function optionalAuth(request: AuthenticatedRequest, _response: Response, next: NextFunction): Promise<void> {
  try {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!token) return next();
    const tokenHash = hashSessionToken(token);
    const session = await AuthSessionModel.findOne({ tokenHash, expiresAt: { $gt: new Date() } }).lean();
    if (!session) return next();
    const user = await UserModel.findById(session.userId).lean();
    if (!user || user.status !== "ACTIVE") return next();
    request.authUser = publicUser(user);
    request.sessionTokenHash = tokenHash;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
  if (!request.authUser) {
    response.status(401).json({ ok: false, message: "Authentication required." });
    return;
  }
  next();
}

const permissionForPath = (path: string): AdminPermission => {
  if (path.includes("/bets")) return "BETS";
  if (path.includes("/referrals")) return "REFERRALS";
  if (path.includes("/payment-methods")) return "PAYMENT_METHODS";
  if (path.includes("/bonuses")) return "BONUSES";
  if (path.includes("/users")) return "USERS";
  if (path.includes("/deposits")) return "DEPOSITS";
  if (path.includes("/withdrawals")) return "WITHDRAWALS";
  if (path.includes("/audit") || path.includes("/transactions")) return "AUDIT";
  if (path.includes("/settings")) return "SETTINGS";
  if (path.includes("/support")) return "SUPPORT";
  if (path.includes("/content")) return "CONTENT";
  if (path.includes("/subadmins")) return "TEAM";
  if (path.includes("/reports")) return "REPORTS";
  if (path.includes("/faqs")) return "FAQS";
  if (path.includes("/notifications")) return "NOTIFICATIONS";
  if (path.includes("/game-control")) return "GAME_CONTROL";
  return "OVERVIEW";
};

export function requireAdmin(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
  const admin = request.authUser;
  if (!admin || !["ADMIN", "SUB_ADMIN"].includes(admin.role)) {
    response.status(403).json({ ok: false, message: "Administrator access required." });
    return;
  }
  if (admin.role === "SUB_ADMIN") {
    const permission = permissionForPath(request.originalUrl || request.path);
    if (!admin.adminPermissions.includes(permission)) {
      response.status(403).json({ ok: false, message: `Access to ${permission.toLowerCase().replaceAll("_", " ")} is not permitted.` });
      return;
    }
  }
  next();
}

export const requireAdminPermission = (permission: AdminPermission) =>
  (request: AuthenticatedRequest, response: Response, next: NextFunction): void => {
    const admin = request.authUser;
    if (!admin || !["ADMIN", "SUB_ADMIN"].includes(admin.role)) {
      response.status(403).json({ ok: false, message: "Administrator access required." });
      return;
    }
    if (admin.role === "SUB_ADMIN" && !admin.adminPermissions.includes(permission)) {
      response.status(403).json({ ok: false, message: `Access to ${permission.toLowerCase().replaceAll("_", " ")} is not permitted.` });
      return;
    }
    next();
  };

export async function bootstrapAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    console.warn("ADMIN_EMAIL/ADMIN_PASSWORD not set; automatic admin bootstrap skipped.");
    return;
  }
  if (password.length < 10) {
    throw new Error("ADMIN_PASSWORD must contain at least 10 characters.");
  }

  const existing = await UserModel.findOne({ email }).select("+passwordHash");
  if (existing) {
    if (existing.role !== "ADMIN") {
      existing.role = "ADMIN";
      await existing.save();
    }
    return;
  }

  await UserModel.create({
    name: process.env.ADMIN_NAME?.trim() || "Platform Admin",
    email,
    passwordHash: await hashPassword(password),
    authProvider: "PASSWORD",
    role: "ADMIN",
    status: "ACTIVE",
    balanceMinor: 0,
    withdrawalLockedMinor: 0,
    bettingLockedMinor: 0,
    pendingRewardsMinor: 0,
    balance: 0,
    lockedBalance: 0
  });
  console.log(`Admin account created for ${email}`);
}
