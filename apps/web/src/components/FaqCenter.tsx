import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";

interface Faq { _id: string; question: string; answer: string; category: string; }
interface Props { onClose: () => void; }

export function FaqCenter({ onClose }: Props) {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { void apiRequest<{ faqs: Faq[] }>("/api/faqs").then((result) => setFaqs(result.faqs)).catch(() => setFaqs([])); }, []);
  const filtered = useMemo(() => faqs.filter((item) => `${item.question} ${item.answer} ${item.category}`.toLowerCase().includes(query.toLowerCase())), [faqs, query]);
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="faq-center"><header><div><span>HELP CENTER</span><h2>Frequently Asked Questions</h2></div><button onClick={onClose}>×</button></header><div className="faq-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search account, deposits, withdrawals…" /></div><div className="faq-list">{filtered.length === 0 ? <p>No matching FAQs.</p> : filtered.map((item) => <article key={item._id}><button onClick={() => setOpenId(openId === item._id ? null : item._id)}><span><small>{item.category}</small><strong>{item.question}</strong></span><b>{openId === item._id ? "−" : "+"}</b></button>{openId === item._id && <p>{item.answer}</p>}</article>)}</div></section></div>;
}
