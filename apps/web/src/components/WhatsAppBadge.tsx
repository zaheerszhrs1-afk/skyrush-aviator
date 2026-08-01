import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

export function WhatsAppBadge() {
  const [config, setConfig] = useState({ whatsappNumber: "", whatsappMessage: "" });
  useEffect(() => { void apiRequest<typeof config>("/api/public-config").then(setConfig).catch(() => undefined); }, []);
  if (!config.whatsappNumber) return null;
  const href = `https://wa.me/${config.whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(config.whatsappMessage || "Hello, I need support with my B9T9 account.")}`;
  return <a className="floating-whatsapp" href={href} target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3.5A12.45 12.45 0 0 0 5.25 22.25L3.5 28.5l6.45-1.69A12.5 12.5 0 1 0 16 3.5Z" fill="currentColor" /><path d="M22.37 18.72c-.27-.14-1.63-.8-1.88-.9-.25-.09-.43-.14-.61.14-.18.27-.7.9-.86 1.09-.16.18-.32.2-.59.07a9.94 9.94 0 0 1-2.94-1.82 11.1 11.1 0 0 1-2.04-2.54c-.21-.36.23-.33.65-1.1.09-.18.05-.33-.03-.47-.07-.14-.61-1.47-.84-2.02-.22-.53-.44-.46-.61-.47h-.52c-.18 0-.47.07-.72.34-.25.27-.95.93-.95 2.27s.98 2.63 1.11 2.81c.14.18 1.93 2.95 4.68 4.13 1.73.74 2.4.8 3.27.67.53-.08 1.63-.67 1.86-1.31.23-.65.23-1.2.16-1.31-.07-.12-.25-.18-.52-.31Z" fill="#0d5d2b" /></svg></a>;
}
