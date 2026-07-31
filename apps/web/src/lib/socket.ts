import { io } from "socket.io-client";

const url = import.meta.env.VITE_SOCKET_URL || undefined;
export const socket = io(url, {
  transports: ["websocket"],
  autoConnect: false,
  withCredentials: true
});
