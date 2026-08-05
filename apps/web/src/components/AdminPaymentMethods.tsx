import { useState } from "react";
import { apiRequest } from "../lib/api";

export interface PaymentMethodConfig {
  id: string;
  code: string;
  title: string;
  logoUrl: string;
  qrImageUrl: string;
  identifierLabel: string;
  identifierValue: string;
  instructions: string;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  receiptRequired: boolean;
  sortOrder: number;
}

interface Props {
  methods: PaymentMethodConfig[];
  busy: boolean;
  onChange: (methods: PaymentMethodConfig[]) => void;
  onSave: () => void;
  onMessage: (message: string) => void;
}

const createMethod = (index: number): PaymentMethodConfig => ({
  id: `payment-${Date.now()}-${index}`,
  code: `PaymentMethod${index}`,
  title: "New payment method",
  logoUrl: "",
  qrImageUrl: "",
  identifierLabel: "ACCOUNT ID",
  identifierValue: "",
  instructions: "Complete the payment and upload the receipt for verification.",
  depositEnabled: true,
  withdrawalEnabled: true,
  receiptRequired: true,
  sortOrder: (index + 1) * 10
});

export function AdminPaymentMethods({ methods, busy, onChange, onSave, onMessage }: Props) {
  const [uploading, setUploading] = useState<string | null>(null);
  const update = (index: number, patch: Partial<PaymentMethodConfig>) => onChange(methods.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const upload = async (index: number, file: File, field: "logoUrl" | "qrImageUrl") => {
    if (!file.type.startsWith("image/")) { onMessage("Please select an image file."); return; }
    if (file.size > 5 * 1024 * 1024) { onMessage("Image must be smaller than 5 MB."); return; }
    setUploading(`${index}:${field}`);
    try {
      const fileDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Unable to read image."));
        reader.readAsDataURL(file);
      });
      const result = await apiRequest<{ imageUrl: string }>("/api/admin/payment-methods/upload", { method: "POST", body: JSON.stringify({ fileDataUrl }) });
      update(index, { [field]: result.imageUrl } as Pick<PaymentMethodConfig, typeof field>);
      onMessage(field === "qrImageUrl" ? "QR image uploaded. Save payment methods to publish it." : "Logo uploaded. Save payment methods to publish it.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setUploading(null);
    }
  };

  return <form className="admin-payment-methods" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <div className="payment-methods-heading"><div><span>PAYMENT CONFIGURATION</span><h2>Deposit & withdrawal methods</h2><p>Change titles, payment IDs, instructions, logos and QR images shown in the user's wallet.</p></div><div><button type="button" onClick={() => onChange([...methods, createMethod(methods.length + 1)])}>Add method</button><button className="save-settings" disabled={busy}>Save all methods</button></div></div>
    <div className="payment-method-editor-list">{methods.map((item, index) => <article className="payment-method-editor" key={item.id}>
      <header><div className="payment-method-preview-logo">{item.logoUrl ? <img src={item.logoUrl} alt="" /> : <span>{item.title.slice(0, 2).toUpperCase()}</span>}</div><div><span>METHOD {index + 1}</span><h3>{item.title || "Untitled method"}</h3><small>{item.code}</small></div><button type="button" className="danger" disabled={methods.length <= 1} onClick={() => onChange(methods.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></header>
      <div className="payment-method-form-grid">
        <label>Display title<input value={item.title} onChange={(event) => update(index, { title: event.target.value })} required /></label>
        <label>Method code<input value={item.code} onChange={(event) => update(index, { code: event.target.value })} required /><small>Keep unique; saved on deposit/withdrawal records.</small></label>
        <label>Payment ID title<input value={item.identifierLabel} onChange={(event) => update(index, { identifierLabel: event.target.value })} placeholder="TILL ID / RAAST ID" /></label>
        <label>Payment ID / account<input value={item.identifierValue} onChange={(event) => update(index, { identifierValue: event.target.value })} /></label>
        <label>Sort order<input type="number" value={item.sortOrder} onChange={(event) => update(index, { sortOrder: Number(event.target.value) })} /></label>
        <label className="wide">Instructions<textarea value={item.instructions} onChange={(event) => update(index, { instructions: event.target.value })} rows={3} /></label>
      </div>
      <div className="payment-image-management">
        <label><span>Method logo</span><div className="payment-image-preview logo">{item.logoUrl ? <img src={item.logoUrl} alt={`${item.title} logo`} /> : <small>No logo</small>}</div><input type="file" accept="image/*" disabled={uploading !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(index, file, "logoUrl"); event.currentTarget.value = ""; }} /><input value={item.logoUrl} onChange={(event) => update(index, { logoUrl: event.target.value })} placeholder="Or paste image URL" />{uploading === `${index}:logoUrl` && <small>Uploading logo…</small>}</label>
        <label><span>QR code image</span><div className="payment-image-preview qr">{item.qrImageUrl ? <img src={item.qrImageUrl} alt={`${item.title} QR`} /> : <small>No QR image</small>}</div><input type="file" accept="image/*" disabled={uploading !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(index, file, "qrImageUrl"); event.currentTarget.value = ""; }} /><input value={item.qrImageUrl} onChange={(event) => update(index, { qrImageUrl: event.target.value })} placeholder="Or paste image URL" />{uploading === `${index}:qrImageUrl` && <small>Uploading QR…</small>}</label>
      </div>
      <div className="payment-method-toggles"><label><input type="checkbox" checked={item.depositEnabled} onChange={(event) => update(index, { depositEnabled: event.target.checked })} /> Show for deposits</label><label><input type="checkbox" checked={item.withdrawalEnabled} onChange={(event) => update(index, { withdrawalEnabled: event.target.checked })} /> Show for withdrawals</label><label><input type="checkbox" checked={item.receiptRequired} onChange={(event) => update(index, { receiptRequired: event.target.checked })} /> Receipt required</label></div>
    </article>)}</div>
  </form>;
}
