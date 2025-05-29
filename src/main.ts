import * as datalink from "./datalink";
import * as ipv4 from "./ipv4";
import * as arp from "./arp";

export function init() {
  datalink.init();

  // Whenever a frame arrives, pass it straight into the IPv4 layer
  datalink.setOnReceiveCallback((iface, frame) => {
    ipv4.handleDataLinkFrame(iface, frame.protocol, frame.payload);
  });

  // EtherType → network-layer demux
  ipv4.registerProtocolHandler(datalink.ETHERTYPE_ARP, arp.handleNetworkPacket);
  ipv4.registerProtocolHandler(datalink.ETHERTYPE_IPV4, ipv4.handleIPv4Packet);
}

export function runEventLoop(): never {
  while (true) {
    // os.pullEvent returns [ eventName, ...args ]
    const ev = { ...os.pullEvent("modem_message") } as any[];
    // [0] = "modem_message", [1] = side, [5] = raw JSON frame
    const side = ev[1];
    const raw = ev[5];
    datalink.handleModemMessage(side, raw);
  }
}
