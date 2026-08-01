import { useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { CampaignDesign } from "./CampaignExperience";

export interface ContentItem {
  _id: string;
  type: "POPUP" | "BANNER" | "ANNOUNCEMENT" | "NEWS";
  title: string;
  body: string;
  imageUrl?: string;
  imageData?: string;
  linkUrl?: string;
  linkLabel?: string;
  linkTarget?: string;
  placement: string;
  enabled: boolean;
  dismissible: boolean;
  priority: number;
  startsAt?: string;
  endsAt?: string;
  design?: CampaignDesign;
}

type ContentForm = Omit<ContentItem, "_id">;
type RunAction = (action: () => Promise<void>, success?: string) => Promise<void>;

interface Props {
  items: ContentItem[];
  run: RunAction;
  onReload: () => Promise<void>;
}

const blankContent = (): ContentForm => ({
  type: "ANNOUNCEMENT", title: "", body: "", imageUrl: "", imageData: "", linkUrl: "", linkLabel: "Learn more", linkTarget: "",
  placement: "GAME", enabled: true, dismissible: true, priority: 0, startsAt: "", endsAt: "",
  design: { accentColor: "#ff6b8d", backgroundColor: "#181b20", textColor: "#f5f7fa", align: "LEFT", buttonStyle: "SOLID" }
});

const dateTimeLocalValue = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const imageFor = (item: Partial<ContentForm>) => item.imageData || item.imageUrl;

export function AdminContentStudio({ items, run, onReload }: Props) {
  const [form, setForm] = useState<ContentForm>(blankContent);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [localError, setLocalError] = useState("");
  const previewStyle = useMemo(() => ({
    "--campaign-accent": form.design?.accentColor || "#ff6b8d",
    "--campaign-background": form.design?.backgroundColor || "#181b20",
    "--campaign-text": form.design?.textColor || "#f5f7fa",
    textAlign: form.design?.align === "CENTER" ? "center" : "left"
  } as CSSProperties), [form.design]);

  const update = (key: keyof ContentForm, value: unknown) => setForm((current) => ({ ...current, [key]: value } as ContentForm));
  const updateDesign = (key: keyof CampaignDesign, value: string) => setForm((current) => ({ ...current, design: { ...current.design, [key]: value } }));

  const readImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setLocalError("Choose an image file."); return; }
    if (file.size > 600_000) { setLocalError("Please choose an image smaller than 600 KB."); return; }
    const reader = new FileReader();
    reader.onload = () => { setLocalError(""); update("imageData", String(reader.result || "")); };
    reader.onerror = () => setLocalError("The image could not be read.");
    reader.readAsDataURL(file);
  };

  const reset = () => { setEditingId(null); setForm(blankContent()); setLocalError(""); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      ...form,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : "",
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : ""
    };
    await run(async () => {
      await fetch(editingId ? `/api/admin/content/${editingId}` : "/api/admin/content", {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Unable to save content.");
      });
      reset();
      await onReload();
    }, editingId ? "Campaign updated." : "Campaign created.");
  };

  return <div className="content-studio">
    <div className="content-studio-grid">
      <form className="admin-editor content-editor" onSubmit={submit}>
        <div><span className="studio-eyebrow">CAMPAIGN STUDIO</span><h2>{editingId ? "Edit campaign" : "Create campaign"}</h2><p>Build banners, popups, announcements and news cards with a live preview.</p></div>
        {localError && <div className="content-local-error">{localError}</div>}
        <label>Format<select value={form.type} onChange={(event) => update("type", event.target.value)}><option value="BANNER">Banner</option><option value="POPUP">Popup</option><option value="ANNOUNCEMENT">Announcement</option><option value="NEWS">News</option></select></label>
        <label>Title<input required value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="e.g. Weekend deposit boost" /></label>
        <label>Message<textarea value={form.body} onChange={(event) => update("body", event.target.value)} placeholder="Write the offer or update shown to players." /></label>
        <div className="content-fieldset"><strong>Visual asset</strong><label>Upload image<input type="file" accept="image/*" onChange={(event) => readImage(event.target.files?.[0])} /></label><label>Or use image URL<input value={form.imageUrl || ""} onChange={(event) => update("imageUrl", event.target.value)} placeholder="https://..." /></label>{imageFor(form) && <button type="button" className="editor-secondary" onClick={() => { update("imageData", ""); update("imageUrl", ""); }}>Remove image</button>}</div>
        <div className="content-fieldset"><strong>Action</strong><label>Website tab or page<select value={form.linkTarget || ""} onChange={(event) => update("linkTarget", event.target.value)}><option value="">No in-app destination</option><option value="BONUSES">VIP Bonuses</option><option value="DEPOSIT">Wallet / Deposit</option><option value="WITHDRAW">Wallet / Withdraw</option><option value="PROFILE">Profile & settings</option><option value="FAQS">Help & FAQs</option><option value="LIVE_CHAT">Live chat</option></select></label><label>External URL<input value={form.linkUrl || ""} onChange={(event) => update("linkUrl", event.target.value)} placeholder="https://..." /></label><label>Button label<input value={form.linkLabel || ""} onChange={(event) => update("linkLabel", event.target.value)} /></label></div>
        <div className="design-controls"><label>Accent<input type="color" value={form.design?.accentColor || "#ff6b8d"} onChange={(event) => updateDesign("accentColor", event.target.value)} /></label><label>Background<input type="color" value={form.design?.backgroundColor || "#181b20"} onChange={(event) => updateDesign("backgroundColor", event.target.value)} /></label><label>Text<input type="color" value={form.design?.textColor || "#f5f7fa"} onChange={(event) => updateDesign("textColor", event.target.value)} /></label><label>Align<select value={form.design?.align || "LEFT"} onChange={(event) => updateDesign("align", event.target.value)}><option>LEFT</option><option>CENTER</option></select></label><label>Button<select value={form.design?.buttonStyle || "SOLID"} onChange={(event) => updateDesign("buttonStyle", event.target.value)}><option>SOLID</option><option>OUTLINE</option></select></label></div>
        <div className="content-meta-grid"><label>Placement<select value={form.placement} onChange={(event) => update("placement", event.target.value)}><option>LOGIN</option><option>GAME</option><option>BOTH</option></select></label><label>Priority<input type="number" value={form.priority} onChange={(event) => update("priority", Number(event.target.value))} /></label><label>Starts at<input type="datetime-local" value={dateTimeLocalValue(form.startsAt)} onChange={(event) => update("startsAt", event.target.value)} /></label><label>Ends at<input type="datetime-local" value={dateTimeLocalValue(form.endsAt)} onChange={(event) => update("endsAt", event.target.value)} /></label></div>
        <label className="toggle-setting"><input type="checkbox" checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} /> Visible to players</label><label className="toggle-setting"><input type="checkbox" checked={form.dismissible} onChange={(event) => update("dismissible", event.target.checked)} /> Allow dismissing</label>
        <div className="admin-actions"><button className="save-settings">{editingId ? "Save campaign" : "Create campaign"}</button>{editingId && <button type="button" className="editor-secondary" onClick={reset}>Cancel</button>}</div>
      </form>
      <div className="content-preview-card"><div className="content-preview-header"><div><span className="studio-eyebrow">PLAYER PREVIEW</span><strong>{form.type}</strong></div><small>{form.placement}</small></div><div className={`campaign-preview campaign-preview-${form.type.toLowerCase()}`} style={previewStyle}>{imageFor(form) && <img src={imageFor(form)} alt="" />}<div><span>{form.type}</span><h3>{form.title || "Your campaign title"}</h3><p>{form.body || "Your campaign message will appear here."}</p>{(form.linkTarget || form.linkUrl) && <button className={form.design?.buttonStyle === "OUTLINE" ? "outline" : ""}>{form.linkLabel || "Learn more"}</button>}</div></div><p className="preview-note">This is how the campaign will feel inside the game shell. You can edit it any time without replacing other active campaigns.</p></div>
    </div>
    <div className="content-list-header"><div><span className="studio-eyebrow">ACTIVE LIBRARY</span><h2>Campaigns & promotions</h2></div><small>{items.length} saved campaign{items.length === 1 ? "" : "s"}</small></div>
    <div className="admin-card-list content-library">{items.length === 0 ? <div className="admin-empty-state">No campaigns yet. Create the first banner, popup, announcement or news item.</div> : items.map((item) => <article key={item._id}><div className="content-card-media">{imageFor(item) ? <img src={imageFor(item)} alt="" /> : <span>{item.type[0]}</span>}</div><div className="content-card-copy"><span>{item.type} · {item.placement}</span><h3>{item.title}</h3><p>{item.body}</p><small>{item.enabled ? "Visible" : "Hidden"} · Priority {item.priority}</small></div><div className="content-card-actions"><button onClick={() => { setEditingId(item._id); setForm({ ...blankContent(), ...item, design: { ...blankContent().design, ...item.design } }); }}>Edit</button><button onClick={() => void run(async () => { const response = await fetch(`/api/admin/content/${item._id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !item.enabled }) }); if (!response.ok) throw new Error("Unable to update campaign."); await onReload(); }, item.enabled ? "Campaign hidden." : "Campaign published.")}>{item.enabled ? "Hide" : "Publish"}</button><button className="danger" onClick={() => void run(async () => { const response = await fetch(`/api/admin/content/${item._id}`, { method: "DELETE", credentials: "include" }); if (!response.ok) throw new Error("Unable to delete campaign."); await onReload(); }, "Campaign deleted.")}>Delete</button></div></article>)}</div>
  </div>;
}
