import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";

type BadgePosition = { left: number; top: number };
type DragState = { pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean };

const BADGE_POSITION_KEY = "b9t9-whatsapp-badge-position";
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export function WhatsAppBadge() {
  const [config, setConfig] = useState({ whatsappNumber: "", whatsappMessage: "" });
  const [position, setPosition] = useState<BadgePosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => { void apiRequest<typeof config>("/api/public-config").then(setConfig).catch(() => undefined); }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BADGE_POSITION_KEY) ?? "null") as Partial<BadgePosition> | null;
      if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) setPosition({ left: Number(saved!.left), top: Number(saved!.top) });
    } catch { /* Ignore invalid or unavailable local storage. */ }
  }, []);
  useEffect(() => {
    if (!position) return;
    try { localStorage.setItem(BADGE_POSITION_KEY, JSON.stringify(position)); } catch { /* Ignore unavailable local storage. */ }
  }, [position]);
  if (!config.whatsappNumber) return null;
  const href = `https://wa.me/${config.whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(config.whatsappMessage || "Hello, I need support with my B9T9 account.")}`;
  const style = position ? { left: `${position.left}px`, top: `${position.top}px`, right: "auto", bottom: "auto" } : undefined;
  const handlePointerDown = (event: React.PointerEvent<HTMLAnchorElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragState.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: rect.left, originY: rect.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLAnchorElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) state.moved = true;
    if (!state.moved) return;
    setPosition({
      left: clamp(state.originX + deltaX, 8, window.innerWidth - rect.width - 8),
      top: clamp(state.originY + deltaY, 8, window.innerHeight - rect.height - 8)
    });
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLAnchorElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.moved) suppressClick.current = true;
    dragState.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (suppressClick.current) {
      event.preventDefault();
      suppressClick.current = false;
    }
  };
  return <a className={`floating-whatsapp${dragging ? " dragging" : ""}`} style={style} href={href} target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onClick={handleClick}><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3.5A12.45 12.45 0 0 0 5.25 22.25L3.5 28.5l6.45-1.69A12.5 12.5 0 1 0 16 3.5Z" fill="currentColor" /><path d="M22.37 18.72c-.27-.14-1.63-.8-1.88-.9-.25-.09-.43-.14-.61.14-.18.27-.7.9-.86 1.09-.16.18-.32.2-.59.07a9.94 9.94 0 0 1-2.94-1.82 11.1 11.1 0 0 1-2.04-2.54c-.21-.36.23-.33.65-1.1.09-.18.05-.33-.03-.47-.07-.14-.61-1.47-.84-2.02-.22-.53-.44-.46-.61-.47h-.52c-.18 0-.47.07-.72.34-.25.27-.95.93-.95 2.27s.98 2.63 1.11 2.81c.14.18 1.93 2.95 4.68 4.13 1.73.74 2.4.8 3.27.67.53-.08 1.63-.67 1.86-1.31.23-.65.23-1.2.16-1.31-.07-.12-.25-.18-.52-.31Z" fill="#0d5d2b" /></svg></a>;
}
