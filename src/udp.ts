import { IPv4Packet } from "./ipv4";

type TransportHandler = (src_ip: string, data: unknown) => void;

let sendPacketFunc: ((dest_ip: string, protocol: number, payload: string) => LuaMultiReturn<[boolean, string]>) | null = null;
const handlers = new Map<number, TransportHandler>();
const UDP_PROTOCOL = 17;

export function registerHandler(port: number, handler: TransportHandler): boolean {
  if (handlers.has(port)) {
    return false;
  }
  handlers.set(port, handler);
  return true;
}

export function unregisterHandler(port: number): boolean {
  return handlers.delete(port);
}

export function handleNetworkPacket(packet: IPv4Packet) {
  const json = typeof packet.payload === "string"
    ? textutils.unserialiseJSON(packet.payload)
    : null;
  if (!json || typeof json.port !== "number") return;

  const h = handlers.get(json.port);
  if (h) h(packet.src_ip, json.data);
}

export function sendData(dest_ip: string, port: number, data: unknown): LuaMultiReturn<[boolean, string]> {
  if (!sendPacketFunc) return [false, "No send packet function set"] as LuaMultiReturn<[boolean, string]>;
  const tp = textutils.serialiseJSON({ port, data });
  return sendPacketFunc(dest_ip, UDP_PROTOCOL, tp);
}

export function setSendPacketFunction(
  fn: (dest_ip: string, protocol: number, payload: string) => LuaMultiReturn<[boolean, string]>
) {
  sendPacketFunc = fn;
}
