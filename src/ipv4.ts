import * as datalink from "./datalink";
import * as arp from "./arp";
import * as udp from "./udp";

export interface Route {
  next_hop_ip: string | null;
  interface_name: string;
}

export interface IPv4Packet {
  version: number;
  ihl: number;
  tos: number;
  total_length: number;
  id: number;
  flags: number;
  fragment_offset: number;
  ttl: number;
  protocol: number;
  header_checksum: number;
  src_ip: string;
  dest_ip: string;
  options?: unknown;
  payload: unknown;
}

export type ProtocolHandler = (
  payload: string,
  receivingInterface: datalink.ModemInterface
) => void;

const routingTable = new LuaTable<string, Route>();
const etherTypeHandlers = new LuaTable<number, ProtocolHandler>();

export function registerProtocolHandler(ethertype: number, handler: ProtocolHandler) {
  etherTypeHandlers.set(ethertype, handler);
}

export function configureInterface(interface_name: string, ip: string, subnet: string): boolean {
  const iface = datalink.getInterface(interface_name);
  if (!iface) {
    print("Network Error: Interface not found:", interface_name);
    return false;
  }
  iface.ip_address = ip;
  iface.subnet_mask = subnet;
  print("Network: Configured interface", interface_name, "IP:", ip, "Subnet:", subnet);

  const network_addr = getNetworkAddress(ip, subnet);
  const cidr = subnetToCIDR(subnet);
  addRoute(`${network_addr}/${cidr}`, null, interface_name);

  return true;
}

export function addRoute(destination: string, next_hop_ip: string | null, interface_name: string): void {
  routingTable.set(destination, { next_hop_ip, interface_name });
  print("Network: Added route", destination, "via", next_hop_ip ?? "direct", "on interface", interface_name);
}

export function removeRoute(destination: string): void {
  routingTable.delete(destination);
  print("Network: Removed route", destination);
}

export function getRoutingTable(): LuaTable<string, Route> {
  return routingTable;  // no cloning
}

export function handleDataLinkFrame(
  iface: datalink.ModemInterface,
  ethertype: number,
  payload: string
) {
  const h = etherTypeHandlers.get(ethertype);
  if (h) h(payload, iface);
  // else ignore
}

export function handleIPv4Packet(raw: string, iface: datalink.ModemInterface) {
  const pkt = textutils.unserialiseJSON(raw) as IPv4Packet;
  if (!pkt || pkt.version !== 4) return;

  // Am I the destination?
  const myIfaces = datalink.getInterfaces();
  const forMe = myIfaces.some(i =>
    i.ip_address &&
    (pkt.dest_ip === i.ip_address || isBroadcastAddress(pkt.dest_ip, i.subnet_mask))
  );

  if (!forMe) {
    forwardPacket(iface, pkt);
    return;
  }

  // Dispatch IP protocols: 1=ICMP, 6=TCP, 17=UDP, etc.
  if (pkt.protocol === 17) {
    udp.handleNetworkPacket(pkt);
  }
  // else silently drop or extend with e.g. icmp.handle(pkt)
}

export function sendPacket(dest_ip: string, protocol: number, payload: unknown): LuaMultiReturn<[boolean, string]> {
  const route = determineRoute(dest_ip);
  if (!route) {
    return [false, "No route to destination"] as LuaMultiReturn<[boolean, string]>;
  }

  const iface = datalink.getInterface(route.interface_name);
  if (!iface || !iface.ip_address) {
    return [false, "Invalid interface for route"] as LuaMultiReturn<[boolean, string]>;
  }

  const next_hop = route.next_hop_ip ?? dest_ip;
  const next_hop_mac = arp.resolveIP(next_hop);

  const serializedPayload = textutils.serialiseJSON(payload);
  const packet: IPv4Packet = {
    version: 4,
    ihl: 5,
    tos: 0,
    total_length: serializedPayload.length + 20,
    id: math.random(65535),
    flags: 0,
    fragment_offset: 0,
    ttl: 64,
    protocol,
    header_checksum: 0,
    src_ip: iface.ip_address,
    dest_ip,
    options: undefined,
    payload,
  };

  if (!next_hop_mac) {
    arp.storePendingPacket(packet, iface);
    arp.sendARPRequest(next_hop, iface);
    return [false, "Next hop MAC address not resolved"] as LuaMultiReturn<[boolean, string]>;
  }

  const raw_packet = textutils.serialiseJSON(packet);
  datalink.sendFrame(iface, next_hop_mac, datalink.ETHERTYPE_IPV4, raw_packet);

  return [true, "Packet sent successfully"] as LuaMultiReturn<[boolean, string]>;
}

export function forwardPacket(receivingInterface: datalink.ModemInterface, packet: IPv4Packet): void {
  packet.ttl = (packet.ttl ?? 0) - 1;
  if (packet.ttl <= 0) {
    return;
  }

  const route = determineRoute(packet.dest_ip);
  if (!route) {
    return;
  }

  const iface = datalink.getInterface(route.interface_name);
  if (!iface || iface === receivingInterface) {
    return;
  }

  const next_hop = route.next_hop_ip ?? packet.dest_ip;
  const next_hop_mac = arp.resolveIP(next_hop);
  if (!next_hop_mac) {
    arp.storePendingPacket(packet, iface);
    arp.sendARPRequest(next_hop, iface);
    return;
  }

  const raw_packet = textutils.serialiseJSON(packet);
  datalink.sendFrame(iface, next_hop_mac, datalink.ETHERTYPE_IPV4, raw_packet);
}

export function determineRoute(dest_ip: string): Route | undefined {
  for (const iface of datalink.getInterfaces()) {
    if (
      iface.ip_address &&
      iface.subnet_mask &&
      isInSameSubnet(dest_ip, iface.ip_address, iface.subnet_mask)
    ) {
      return { next_hop_ip: null, interface_name: iface.name };
    }
  }

  let best_route: Route | undefined;
  let best_prefix = -1;

  for (const [dest, route] of routingTable) {
    // split "network/prefix" into ["network","prefix"]
    const parts = dest.split("/");
    if (parts.length === 0) continue;
    const network_addr = parts[0];
    // if no prefix given, default to 32
    const prefix = (parts.length > 1 && parts[1] !== "")
      ? Number(parts[1])
      : 32;
    // skip invalid numeric prefix
    if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) continue;

    if (isIPInNetwork(dest_ip, network_addr, prefix) && prefix > best_prefix) {
      best_route = route;
      best_prefix = prefix;
    }
  }

  return best_route ?? routingTable.get("0.0.0.0/0");
}

export function isInSameSubnet(ip1: string, ip2: string, mask: string): boolean {
  const toOctets = (ip: string) => ip.split(".").map(Number);

  const ip1o = toOctets(ip1);
  const ip2o = toOctets(ip2);
  const mo = toOctets(mask);

  for (let i = 0; i < 4; i++) {
    if ((ip1o[i] & mo[i]) !== (ip2o[i] & mo[i])) {
      return false;
    }
  }
  return true;
}

export function isIPInNetwork(ip: string, network_addr: string, prefix_length: number): boolean {
  const toInt = (octets: number[]) =>
    octets.reduce((acc, octet, idx) => acc + (octet << (8 * (3 - idx))), 0);

  const toOctets = (ip: string) => ip.split(".").map(Number);

  const ipInt = toInt(toOctets(ip));
  const netInt = toInt(toOctets(network_addr));
  const mask = bit32.bnot(0xffffffff << (32 - prefix_length));

  return (ipInt & mask) === (netInt & mask);
}

export function getNetworkAddress(ip: string, subnet: string): string {
  const toOctets = (ip: string) => ip.split(".").map(Number);

  const ipo = toOctets(ip);
  const mo = toOctets(subnet);
  const net = [];

  for (let i = 0; i < 4; i++) {
    net[i] = ipo[i] & mo[i];
  }

  return net.join(".");
}

export function subnetToCIDR(subnet: string): number {
  let count = 0;
  for (const octetStr of subnet.split(".")) {
    let b = Number(octetStr);
    for (let i = 7; i >= 0; i--) {
      if (bit32.band(b, bit32.lshift(1, i)) !== 0) {
        count++;
      } else {
        break;
      }
    }
  }
  return count;
}

export function isBroadcastAddress(ip: string, subnet: string | undefined): boolean {
  if (ip === "255.255.255.255") {
    return true;
  }
  if (!subnet) {
    return false;
  }

  const net = getNetworkAddress(ip, subnet);

  const toOctets = (ip: string) => ip.split(".").map(Number);

  const ipo = toOctets(ip);
  const neto = toOctets(net);
  const mo = toOctets(subnet);

  for (let i = 0; i < 4; i++) {
    if (ipo[i] !== (neto[i] | (bit32.bnot(mo[i]) & 0xff))) {
      return false;
    }
  }

  return true;
}

// Register the sendPacket function with transport
udp.setSendPacketFunction(sendPacket);
