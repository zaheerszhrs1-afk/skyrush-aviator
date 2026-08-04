import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { apiRequest } from "../lib/api";

export interface CampaignDesign {
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  align?: "LEFT" | "CENTER";
  buttonStyle?: "SOLID" | "OUTLINE";
}

export interface CampaignItem {
  _id: string;
  type: "POPUP" | "BANNER" | "ANNOUNCEMENT" | "NEWS";
  title: string;
  body: string;
  imageUrl?: string;
  imageData?: string;
  linkUrl?: string;
  linkLabel?: string;
  linkTarget?: string;
  dismissible: boolean;
  priority: number;
  design?: CampaignDesign;
}

interface Props { placement: "LOGIN" | "GAME"; }

const internalTargets = new Set(["BONUSES", "REFERRAL", "DEPOSIT", "WITHDRAW", "PROFILE", "FAQS", "LIVE_CHAT"]);

const campaignStyle = (item: CampaignItem): CSSProperties => ({
  "--campaign-accent": item.design?.accentColor || "#ff6b8d",
  "--campaign-background": item.design?.backgroundColor || "#181b20",
  "--campaign-text": item.design?.textColor || "#f5f7fa",
  textAlign: item.design?.align === "CENTER" ? "center" : "left"
} as CSSProperties);

function CampaignAction({ item, children }: { item: CampaignItem; children: string }) {
  const handleInternal = () => {
    if (!item.linkTarget || !internalTargets.has(item.linkTarget)) return;
    window.dispatchEvent(new CustomEvent("b9t9:navigate", { detail: item.linkTarget }));
  };
  if (item.linkTarget && internalTargets.has(item.linkTarget)) return <button className={`campaign-action ${item.design?.buttonStyle === "OUTLINE" ? "outline" : ""}`} onClick={handleInternal}>{children}</button>;
  if (item.linkUrl) return <a className={`campaign-action ${item.design?.buttonStyle === "OUTLINE" ? "outline" : ""}`} href={item.linkUrl} target="_blank" rel="noreferrer">{children}</a>;
  return null;
}

const imageFor = (item: CampaignItem) => item.imageData || item.imageUrl;

export function CampaignExperience({ placement }: Props) {
  const [items, setItems] = useState<CampaignItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [newsOpen, setNewsOpen] = useState(false);

  useEffect(() => {
    void apiRequest<{ items: CampaignItem[] }>(`/api/content/active?placement=${placement}`)
      .then((result) => setItems(result.items))
      .catch(() => setItems([]));
  }, [placement]);

  const banners = useMemo(() => items.filter((item) => item.type === "BANNER" && !dismissed.has(item._id)), [items, dismissed]);
  const popups = useMemo(() => items.filter((item) => item.type === "POPUP" && !dismissed.has(item._id)), [items, dismissed]);
  const news = useMemo(() => items.filter((item) => ["ANNOUNCEMENT", "NEWS"].includes(item.type)), [items]);
  const popup = popups[0];
  const dismiss = (id: string) => setDismissed((current) => new Set([...current, id]));

  return <>
    {banners.length > 0 && <div className="campaign-banner" style={campaignStyle(banners[0])}><div><strong>{banners[0].title}</strong><span>{banners[0].body}</span><CampaignAction item={banners[0]}>{banners[0].linkLabel || "View"}</CampaignAction></div>{banners[0].dismissible && <button onClick={() => dismiss(banners[0]._id)} aria-label="Dismiss banner">X</button>}</div>}
    {news.length > 0 && <button className="campaign-news-button" onClick={() => setNewsOpen(true)} aria-label="Open announcements and news">News<span>{news.length}</span></button>}
    {popup && <div className="campaign-popup-backdrop"><section className="campaign-popup" style={campaignStyle(popup)}>
      {imageFor(popup) && <img src={imageFor(popup)} alt="" />}
      <div><span>{popup.type}</span><h2>{popup.title}</h2><p>{popup.body}</p><CampaignAction item={popup}>{popup.linkLabel || "Learn more"}</CampaignAction></div>
      <button className="campaign-popup-close" onClick={() => dismiss(popup._id)} aria-label="Close announcement">X</button>
    </section></div>}
    {newsOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setNewsOpen(false)}><section className="news-center"><header><div><span>PLATFORM UPDATES</span><h2>Announcements & News</h2></div><button onClick={() => setNewsOpen(false)} aria-label="Close news">X</button></header><div>{news.map((item) => <article key={item._id} style={campaignStyle(item)}>{imageFor(item) && <img src={imageFor(item)} alt="" />}<div><span>{item.type}</span><h3>{item.title}</h3><p>{item.body}</p><CampaignAction item={item}>{item.linkLabel || "Read more"}</CampaignAction></div></article>)}</div></section></div>}
  </>;
}
