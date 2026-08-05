import { useMemo, useState } from "react";
import type { ReferralCommissionRate, ReferralInvitationRule } from "../types";

export interface AdminReferralMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  joinedAt: string;
}

export interface AdminReferralRow {
  userId: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  code: string;
  inviteUrl: string;
  usersCount: number;
  validUsersCount: number;
  rewardsPaid: number;
  rewardCount: number;
  members: AdminReferralMember[];
  createdAt: string;
}

export interface AdminReferralClaim {
  id: string;
  userId: any;
  referredUserId?: any;
  type: "REFERRAL_INVITATION" | "REFERRAL_DEPOSIT" | "REFERRAL_BET";
  amount: number;
  referralLevel: number;
  createdAt: string;
}

export interface AdminReferralData {
  config: {
    referralEnabled: boolean;
    referralMinDeposit: number;
    referralDepositPercent: number;
    referralInvitationRules: ReferralInvitationRule[];
    referralCommissionRates: ReferralCommissionRate[];
  };
  totals: { referralLinks: number; linkedUsers: number; validUsers: number; rewardsPaid: number };
  referrers: AdminReferralRow[];
  claims: AdminReferralClaim[];
}

interface Props {
  data: AdminReferralData;
  busy: boolean;
  onChange: (config: AdminReferralData["config"]) => void;
  onSave: () => void;
}

const money = (value: number) => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} PKR`;
const person = (value: any) => !value ? "System" : typeof value === "string" ? value : `${value.name ?? "User"}${value.email ? ` (${value.email})` : ""}`;

export function AdminReferrals({ data, busy, onChange, onSave }: Props) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.referrers;
    return data.referrers.filter((item) => [item.name, item.email, item.phone, item.code, item.inviteUrl].some((value) => value.toLowerCase().includes(needle)));
  }, [data.referrers, query]);

  const updateInvitation = (index: number, key: keyof ReferralInvitationRule, value: number) => onChange({
    ...data.config,
    referralInvitationRules: data.config.referralInvitationRules.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item)
  });
  const addInvitation = () => onChange({
    ...data.config,
    referralInvitationRules: [...data.config.referralInvitationRules, { level: data.config.referralInvitationRules.length + 1, minInvites: 1, maxInvites: 1, reward: 0 }]
  });
  const removeInvitation = (index: number) => onChange({ ...data.config, referralInvitationRules: data.config.referralInvitationRules.filter((_, itemIndex) => itemIndex !== index) });
  const updateCommission = (index: number, value: number) => onChange({
    ...data.config,
    referralCommissionRates: data.config.referralCommissionRates.map((item, itemIndex) => itemIndex === index ? { ...item, percent: value } : item)
  });

  return <div className="admin-referral-page">
    <div className="admin-kpis referral-admin-kpis">
      <article><span>Referral links</span><strong>{data.totals.referralLinks.toLocaleString()}</strong></article>
      <article><span>Users joined by links</span><strong>{data.totals.linkedUsers.toLocaleString()}</strong></article>
      <article><span>Valid referred users</span><strong>{data.totals.validUsers.toLocaleString()}</strong></article>
      <article><span>Referral rewards paid</span><strong>{money(data.totals.rewardsPaid)}</strong></article>
    </div>

    <form className="bonus-detail-settings admin-referral-settings" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div className="bonus-detail-heading"><div><span>SEPARATE REFERRAL CONTROL</span><h2>Invitation & referral rules</h2><p>Manage qualifying deposits, invitation rewards and team commissions without mixing them into VIP bonuses.</p></div><button className="save-settings" disabled={busy}>Save referral settings</button></div>
      <section className="bonus-settings-section"><header><div><h3>Referral availability</h3><p>These values are applied to all active invitation links.</p></div><label className="toggle-setting"><input type="checkbox" checked={data.config.referralEnabled} onChange={(event) => onChange({ ...data.config, referralEnabled: event.target.checked })} /> Referral system enabled</label></header><div className="bonus-schedule-grid referral-basic-settings"><label>Minimum qualifying deposit<input type="number" min="1" value={data.config.referralMinDeposit} onChange={(event) => onChange({ ...data.config, referralMinDeposit: Number(event.target.value) })} /></label><label>First deposit commission %<input type="number" min="0" max="100" step="0.01" value={data.config.referralDepositPercent} onChange={(event) => onChange({ ...data.config, referralDepositPercent: Number(event.target.value) })} /></label></div></section>
      <section className="bonus-settings-section"><header><div><h3>Invitation bonus tiers</h3><p>Reward is selected according to the number of valid direct users on that referral link.</p></div><button type="button" onClick={addInvitation}>Add tier</button></header><div className="referral-admin-table">{data.config.referralInvitationRules.map((item, index) => <div className="referral-admin-row" key={`${item.level}-${index}`}><label>Level<input type="number" min="1" value={item.level} onChange={(event) => updateInvitation(index, "level", Number(event.target.value))} /></label><label>Min users<input type="number" min="1" value={item.minInvites} onChange={(event) => updateInvitation(index, "minInvites", Number(event.target.value))} /></label><label>Max users<input type="number" min="1" value={item.maxInvites} onChange={(event) => updateInvitation(index, "maxInvites", Number(event.target.value))} /></label><label>Reward PKR<input type="number" min="0" value={item.reward} onChange={(event) => updateInvitation(index, "reward", Number(event.target.value))} /></label><button type="button" className="danger" disabled={data.config.referralInvitationRules.length <= 1} onClick={() => removeInvitation(index)}>Remove</button></div>)}</div></section>
      <section className="bonus-settings-section"><header><div><h3>Betting commission by team level</h3><p>Commission is calculated from settled stake volume across three referral levels.</p></div></header><div className="referral-admin-table">{data.config.referralCommissionRates.map((item, index) => <label className="referral-commission-row" key={item.level}>Level {item.level}<input type="number" min="0" max="100" step="0.01" value={item.percent} onChange={(event) => updateCommission(index, Number(event.target.value))} /> %</label>)}</div></section>
    </form>

    <section className="admin-referral-links">
      <div className="admin-referral-links-heading"><div><span>LINK PERFORMANCE</span><h2>Users in each referral link</h2><p>Every row shows the exact number of accounts registered through that specific invitation URL.</p></div><label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, code or link" /></label></div>
      <div className="admin-table-card referral-links-table"><table><thead><tr><th>Owner</th><th>Referral link</th><th>Users</th><th>Valid users</th><th>Rewards paid</th><th>Action</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.userId}><td><strong>{item.name}</strong><br/><small>{item.email}</small></td><td><code>{item.code}</code><br/><small className="referral-url-cell">{item.inviteUrl}</small></td><td><strong>{item.usersCount}</strong></td><td>{item.validUsersCount}</td><td>{money(item.rewardsPaid)}</td><td><button type="button" onClick={() => setExpanded(expanded === item.userId ? null : item.userId)}>{expanded === item.userId ? "Hide users" : "View users"}</button></td></tr>)}{filtered.length === 0 && <tr><td colSpan={6} className="empty-table-cell">No referral links match this search.</td></tr>}</tbody></table></div>
      {expanded && (() => { const owner = data.referrers.find((item) => item.userId === expanded); if (!owner) return null; return <div className="referral-link-members"><header><div><span>{owner.code}</span><h3>{owner.name}'s referred users</h3><p>{owner.usersCount} total user{owner.usersCount === 1 ? "" : "s"} joined through this link.</p></div><button type="button" onClick={() => setExpanded(null)}>×</button></header><div className="admin-table-card"><table><thead><tr><th>User</th><th>Phone</th><th>Status</th><th>Joined</th></tr></thead><tbody>{owner.members.map((member) => <tr key={member.id}><td><strong>{member.name}</strong><br/><small>{member.email}</small></td><td>{member.phone || "—"}</td><td>{member.status}</td><td>{new Date(member.joinedAt).toLocaleString()}</td></tr>)}{owner.members.length === 0 && <tr><td colSpan={4} className="empty-table-cell">No users have joined through this link yet.</td></tr>}</tbody></table></div>{owner.usersCount > owner.members.length && <small className="referral-member-limit">Showing the latest {owner.members.length} of {owner.usersCount} users.</small>}</div>; })()}
    </section>

    <section className="bonus-settings-section admin-referral-rewards"><header><div><h3>Referral reward history</h3><p>Invitation, deposit and betting commissions are tracked separately from VIP rewards.</p></div><strong>{data.claims.length} recent rewards</strong></header><div className="admin-table-card"><table><thead><tr><th>Date</th><th>Referral owner</th><th>Referred user</th><th>Type</th><th>Level</th><th>Amount</th></tr></thead><tbody>{data.claims.map((claim) => <tr key={claim.id}><td>{new Date(claim.createdAt).toLocaleString()}</td><td>{person(claim.userId)}</td><td>{person(claim.referredUserId)}</td><td>{claim.type === "REFERRAL_INVITATION" ? "Invitation reward" : claim.type === "REFERRAL_DEPOSIT" ? "Deposit commission" : "Bet commission"}</td><td>{claim.referralLevel || 1}</td><td><strong>{money(claim.amount)}</strong></td></tr>)}{data.claims.length === 0 && <tr><td colSpan={6} className="empty-table-cell">No referral rewards have been paid yet.</td></tr>}</tbody></table></div></section>
  </div>;
}
