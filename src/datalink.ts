export interface ModemInterface {
    name: string;
    peripheral: ModemPeripheral;
    mac_address: string;
    ip_address: string | null;
    subnet_mask: string | null;
}

export interface ModemDataFrame {
    destination_mac: string;
    source_mac: string;
    protocol: number;
    payload: string;
}

const interfaces: ModemInterface[] = [];
let _onReceiveCallback: (iface: ModemInterface, message: ModemDataFrame) => void = undefined;

export function setOnReceiveCallback(callback: (iface: ModemInterface, message: ModemDataFrame) => void) {
    _onReceiveCallback = callback;
}

export const ETHERTYPE_IPV4 = 0x0800;
export const ETHERTYPE_ARP = 0x0806;

export function init() {
    const peripherals = peripheral.getNames();
    for (const name of peripherals) {
        if (peripheral.hasType(name, "modem")) {
            const modem_peripheral = peripheral.wrap(name) as ModemPeripheral;

            interfaces.push({
                name: name,
                peripheral: modem_peripheral,
                mac_address: tostring(os.getComputerID()),
                ip_address: undefined,
                subnet_mask: undefined
            });
        }
    }
}

export function getInterface(name: string): ModemInterface | undefined {
    return interfaces.find(iface => iface.name === name);
}

function replaceInterface(name: string, iface: ModemInterface): void {
    const index = interfaces.findIndex(i => i.name === name);
    if (index !== -1) {
        interfaces[index] = iface;
    } else {
        interfaces.push(iface);
    }
}

export function getInterfaces(): ModemInterface[] {
    return interfaces;
}

export function handleModemMessage(peripheral_name: string, raw_message: string) {
    const iface = getInterface(peripheral_name);
    if (!iface) {
        return;
    }

    const message = textutils.unserialiseJSON(raw_message) as ModemDataFrame;

    const is_broadcast = message.destination_mac === 'broadcast';
    if (message.destination_mac !== iface.mac_address && !is_broadcast) {
        return; // Not for this interface
    }

    if (_onReceiveCallback) {
        _onReceiveCallback(iface, message);
    }
}

export function configureInterface(
    name: string,
    ip_address: string | null,
    subnet_mask: string | null
): ModemInterface | undefined {
    const iface = getInterface(name);
    if (!iface) {
        return undefined;
    }

    iface.ip_address = ip_address;
    iface.subnet_mask = subnet_mask;

    replaceInterface(name, iface);
    print(`Datalink: Configured interface ${name} with IP ${ip_address} and subnet mask ${subnet_mask}`);

    return iface;
}

export function sendFrame(
    iface: ModemInterface,
    destination_mac: string,
    protocol: number,
    payload: string
): void {
    if (!iface || !iface.peripheral) {
        print("Datalink: Invalid interface for sending frame");
        return;
    }

    const frame: ModemDataFrame = {
        destination_mac: destination_mac,
        source_mac: iface.mac_address,
        protocol: protocol,
        payload: payload
    };

    const raw_frame = textutils.serialiseJSON(frame);
    iface.peripheral.transmit(0, 0, raw_frame);
}