import * as datalink from "./datalink";
import * as ipv4 from "./ipv4";
import * as arp from "./arp";
import * as udp from "./udp";

function init() {
  datalink.init();

  // Whenever a frame arrives, pass it straight into the IPv4 layer
  datalink.setOnReceiveCallback((iface, frame) => {
    ipv4.handleDataLinkFrame(iface, frame.protocol, frame.payload);
  });

  // EtherType → network-layer demux
  ipv4.registerProtocolHandler(datalink.ETHERTYPE_ARP, arp.handleNetworkPacket);
  ipv4.registerProtocolHandler(datalink.ETHERTYPE_IPV4, ipv4.handleIPv4Packet);
}

function runEventLoop(): never {
  while (true) {
    const ev = os.pullEvent();
    // [0] = "modem_message", [1] = side, [5] = raw JSON frame
    if (ev[0] === "modem_message") {
      const side = ev[1];
      const raw = ev[5];
      datalink.handleModemMessage(side, raw);
    }
    // [0] = "network_syscall", [1] = syscall, [2] = args...
    else if (ev[0] === "network_syscall") {
      const syscall = ev[1];
      const args = ev.slice(2);
      if (syscall === "send_packet") {
        const [dest_ip, protocol, payload] = args;
        const err = ipv4.sendPacket(dest_ip, protocol, payload)
        if (err[0]) {
          os.queueEvent("network_response", true, err[1]);
        } else {
          os.queueEvent("network_response", false, err[1]);
        }
      } else if (syscall === "send_udp") {
        const [dest_ip, port, data] = args;
        const err = udp.sendData(dest_ip, port, data);
        if (err[0]) {
          os.queueEvent("network_response", true, err[1]);
        } else {
          os.queueEvent("network_response", false, err[1]);
        }
      } else if (syscall === "register_udp_handler") {
        const [port, handler] = args;
        if (udp.registerHandler(port, handler)) {
          os.queueEvent("network_response", true);
        } else {
          os.queueEvent("network_response", false);
        }
      } else if (syscall === "unregister_udp_handler") {
        const [port] = args;
        if (udp.unregisterHandler(port)) {
          os.queueEvent("network_response", true);
        } else {
          os.queueEvent("network_response", false);
        }
      } else {
        os.queueEvent("network_error", `Unknown syscall: ${syscall}`);
      }
    }
  }
}

init();
runEventLoop();