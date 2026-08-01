import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";

export interface CampaignItem {
  _id: string;
  type: "POPUP" | "BANNER" | "ANNOUNCEMENT" | "NEWS";
  title: string;
  body: string;
  imageUrl?: string;
  linkUrl?: string;
  linkLabel?: string;
  dismissible: boolean;
  priority: number;
}

interface Props { placement: "LOGIN" | "GAME"; }

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
    {banners.length > 0 && <div className="campaign-banner"><div><strong>{banners[0].title}</strong><span>{banners[0].body}</span>{banners[0].linkUrl && <a href={banners[0].linkUrl} target="_blank" rel="noreferrer">{banners[0].linkLabel || "View"}</a>}</div>{banners[0].dismissible && <button onClick={() => dismiss(banners[0]._id)}>×</button>}</div>}
    {news.length > 0 && <button className="campaign-news-button" onClick={() => setNewsOpen(true)}>📢<span>{news.length}</span></button>}
    {popup && <div className="campaign-popup-backdrop"><section className="campaign-popup">
      {popup.imageUrl && <img src={popup.imageUrl} alt="" />}
      <div><span>{popup.type}</span><h2>{popup.title}</h2><p>{popup.body}</p>{popup.linkUrl && <a href={popup.linkUrl} target="_blank" rel="noreferrer">{popup.linkLabel || "Learn more"}</a>}</div>
      <button className="campaign-popup-close" onClick={() => dismiss(popup._id)} aria-label="Close announcement">×</button>
    </section></div>}
    {newsOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setNewsOpen(false)}><section className="news-center"><header><div><span>PLATFORM UPDATES</span><h2>Announcements & News</h2></div><button onClick={() => setNewsOpen(false)}>×</button></header><div>{news.map((item) => <article key={item._id}>{item.imageUrl && <img src={item.imageUrl} alt="" />}<div><span>{item.type}</span><h3>{item.title}</h3><p>{item.body}</p>{item.linkUrl && <a href={item.linkUrl} target="_blank" rel="noreferrer">{item.linkLabel || "Read more"}</a>}</div></article>)}</div></section></div>}
  </>;
}
