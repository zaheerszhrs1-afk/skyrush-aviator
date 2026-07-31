import * as crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { promisify } from "node:util";
import { AuthSessionModel, UserModel, type AuthProvider, type UserRole } from "./models.js";
import { fromMinor, minorFromDocument } from "./money.js";

const scryptAsync = promisify(crypto.scrypt);
const SESSION_COOKIE = "b9t9_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

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
  totalBalance: number;
  demoBalance: number;
  authProvider: AuthProvider;
  avatarUrl: string;
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
  const demoBalanceMinor = Number.isSafeInteger(Number(document?.demoBalanceMinor))
    ? Number(document.demoBalanceMinor)
    : 0;

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
    totalBalance: fromMinor(balanceMinor + withdrawalLockedMinor + bettingLockedMinor + pendingRewardsMinor),
    demoBalance: fromMinor(demoBalanceMinor),
    authProvider: (document.authProvider ?? "PASSWORD") as AuthProvider,
    avatarUrl: String(document.avatarUrl ?? "")
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

export function requireAdmin(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
  if (!request.authUser || request.authUser.role !== "ADMIN") {
    response.status(403).json({ ok: false, message: "Administrator access required." });
    return;
  }
  next();
}

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
    demoBalanceMinor: 0,
    balance: 0,
    lockedBalance: 0
  });
  console.log(`Admin account created for ${email}`);
}
