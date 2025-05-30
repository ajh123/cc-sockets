import * as datalink from "./datalink";
import * as ipv4 from "./ipv4";
import * as arp from "./arp";
import * as udp from "./udp";

function save(this: void) {
  const interfaces = datalink.getInterfaces();
  const routingTable = ipv4.getRoutingTable();
  const config = {
    interfaces: interfaces.map(iface => ({
      name: iface.name,
      ip_address: iface.ip_address,
      subnet_mask: iface.subnet_mask,
    })) || [],
    routingTable: [],
  };
  for (const [dest, route] of routingTable) {
    config.routingTable.push({
      destination: dest,
      next_hop_ip: route.next_hop_ip,
      interface_name: route.interface_name,
    });
  }
  const data = textutils.serialiseJSON(config)
  const [file] = fs.open("/etc/network_config.json", "w");
  if (file) {
    file.write(data);
    file.close();
    print("Network configuration saved successfully.");
  } else {
    print("Failed to save network configuration.");
  }
}

function load() {
  const [file] = fs.open("/etc/network_config.json", "r");
  if (file) {
    const data = file.readAll();
    file.close();
    const config = textutils.unserialiseJSON(data);
    if (config && config.interfaces && config.routingTable) {
      for (const iface of config.interfaces) {
        datalink.configureInterface(iface.name, iface.ip_address, iface.subnet_mask);
      }
      for (const route of config.routingTable) {
        ipv4.addRoute(route.destination, route.next_hop_ip, route.interface_name);
      }
      print("Network configuration loaded successfully.");
    } else {
      print("Invalid network configuration format.");
    }
  } else {
    print("No network configuration found, starting with default settings.");
  }
}

function init() {
  datalink.init();

  // Whenever a frame arrives, pass it straight into the IPv4 layer
  datalink.setOnReceiveCallback((iface, frame) => {
    ipv4.handleDataLinkFrame(iface, frame.protocol, frame.payload);
  });

  // EtherType → network-layer demux
  ipv4.registerProtocolHandler(datalink.ETHERTYPE_ARP, arp.handleNetworkPacket);
  ipv4.registerProtocolHandler(datalink.ETHERTYPE_IPV4, ipv4.handleIPv4Packet);

  // Load saved configuration
  load();
}

function runEventLoop(this: void): never {
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
const [ok, err] = pcall(runEventLoop);
if (!ok) {
  print(`Fatal error: ${err}`);
}
const [ok2, err2] = pcall(save);
if (!ok2) {
  print(`Error saving configuration: ${err2}`);
}

print("Press Enter key to exit...")
read();