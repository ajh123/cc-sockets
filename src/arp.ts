import * as datalink from "./datalink";
import type { ModemInterface } from "./datalink";
import type { IPv4Packet } from "./ipv4";

const enum ArpType {
  Request = 1,
  Reply = 2,
}

const ETHERTYPE_ARP = datalink.ETHERTYPE_ARP;

interface PendingPacketInfo {
  packet: IPv4Packet;
  iface: ModemInterface;
}

interface ArpPacket {
  type: ArpType;
  sender_ip: string;
  sender_mac: string;
  target_ip: string;
  target_mac?: string | null;
}

const arpCache = new Map<string, string>(); // ip -> mac
const pendingPackets = new Map<string, PendingPacketInfo[]>(); // ip -> packet list

export function resolveIP(ip: string): string | undefined {
  return arpCache.get(ip);
}

export function cacheMapping(ip: string, mac: string): void {
  arpCache.set(ip, mac);

  const pending = pendingPackets.get(ip);
  if (pending) {
    for (const pktInfo of pending) {
      const rawPacket = textutils.serialiseJSON(pktInfo.packet);
      datalink.sendFrame(pktInfo.iface, mac, datalink.ETHERTYPE_IPV4, rawPacket);
    }
    pendingPackets.delete(ip);
  }
}


export function storePendingPacket(packet: IPv4Packet, iface: ModemInterface): void {
  const ip = packet.dest_ip;
  if (!pendingPackets.has(ip)) {
    pendingPackets.set(ip, []);
  }
  pendingPackets.get(ip)!.push({ packet, iface });
}

export function handleNetworkPacket(rawPayload: string, iface: ModemInterface): void {
  const arpPacket = textutils.unserialiseJSON(rawPayload) as ArpPacket | null;
  if (
    arpPacket === null ||
    (arpPacket.type !== ArpType.Request && arpPacket.type !== ArpType.Reply) ||
    typeof arpPacket.sender_ip !== "string" ||
    typeof arpPacket.sender_mac !== "string"
  ) {
    return;
  }

  if (arpPacket.type === ArpType.Request) {
    if (arpPacket.target_ip === iface.ip_address) {
      sendARPReply(
        arpPacket.sender_ip,
        iface.ip_address!,
        iface.mac_address,
        iface
      );
    }
  } else if (arpPacket.type === ArpType.Reply) {
    cacheMapping(arpPacket.sender_ip, arpPacket.sender_mac);
  }
}

export function sendARPRequest(targetIp: string, iface: ModemInterface): void {
  if (!iface.ip_address || !iface.mac_address) {
    print("ARP: Invalid interface for ARP request");
    return;
  }

  const arpPacket: ArpPacket = {
    type: ArpType.Request,
    sender_ip: iface.ip_address,
    sender_mac: iface.mac_address,
    target_ip: targetIp,
    target_mac: null,
  };

  const ipPacket: IPv4Packet = {
    version: 4,
    ihl: 5,
    tos: 0,
    total_length: textutils.serialiseJSON(arpPacket).length + 20,
    id: Math.floor(Math.random() * 65536),
    flags: 0,
    fragment_offset: 0,
    ttl: 1,
    protocol: ETHERTYPE_ARP,
    header_checksum: 0,
    src_ip: iface.ip_address,
    dest_ip: "255.255.255.255",
    options: null,
    payload: textutils.serialiseJSON(arpPacket),
  };

  const rawPacket = textutils.serialiseJSON(ipPacket);

  datalink.sendFrame(iface, "broadcast", ETHERTYPE_ARP, rawPacket);
}

export function sendARPReply(
  targetIp: string,
  senderIp: string,
  senderMac: string,
  iface: ModemInterface
): void {
  if (!iface.ip_address || !iface.mac_address) {
    print("ARP: Invalid interface for ARP reply");
    return;
  }

  const arpPacket: ArpPacket = {
    type: ArpType.Reply,
    sender_ip: senderIp,
    sender_mac: senderMac,
    target_ip: targetIp,
    target_mac: null,
  };

  const ipPacket: IPv4Packet = {
    version: 4,
    ihl: 5,
    tos: 0,
    total_length: textutils.serialiseJSON(arpPacket).length + 20,
    id: Math.floor(Math.random() * 65536),
    flags: 0,
    fragment_offset: 0,
    ttl: 64,
    protocol: ETHERTYPE_ARP,
    header_checksum: 0,
    src_ip: iface.ip_address,
    dest_ip: targetIp,
    options: null,
    payload: textutils.serialiseJSON(arpPacket),
  };

  const rawPacket = textutils.serialiseJSON(ipPacket);

  datalink.sendFrame(iface, targetIp, ETHERTYPE_ARP, rawPacket);
}
