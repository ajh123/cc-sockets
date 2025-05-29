-- This module provides a simple interface for creating and managing sockets in Lua.
-- It communicates with the cc-socket-daemon over syscalls pushed by os.queueEvent.

local cc_socket = {}

--- Sends a packet to a specified IP address using the specified protocol.
--- @param dest_ip string The destination IP address as a string.
--- @param protocol number The protocol to use (e.g., "tcp", "udp").
--- @param payload string The data to send as a string.
--- @return boolean result true if the packet was sent successfully, false otherwise.
function cc_socket.send_packet(dest_ip, protocol, payload)
  if type(dest_ip) ~= "string" or type(protocol) ~= "number" or type(payload) ~= "string" then
    error("Invalid arguments: dest_ip must be a string, protocol must be a number, and payload must be a string.")
  end
  local event = { "network_syscall", "send_packet", dest_ip, protocol, payload }
  os.queueEvent(table.unpack(event))
  local ev = { os.pullEvent("network_response") }
  return ev[1] == true
end

--- Sends a UDP packet to a specified IP address and port.
--- @param dest_ip string The destination IP address as a string.
--- @param port number The destination port as a number.
--- @param data string The data to send as a string.
--- @return boolean result true if the UDP packet was sent successfully, false otherwise.
function cc_socket.send_udp(dest_ip, port, data)
  if type(dest_ip) ~= "string" or type(port) ~= "number" or type(data) ~= "string" then
    error("Invalid arguments: dest_ip must be a string, port must be a number, and data must be a string.")
  end
  local event = { "network_syscall", "send_udp", dest_ip, port, data }
  os.queueEvent(table.unpack(event))
  local ev = { os.pullEvent("network_response") }
  return ev[1] == true
end

--- Registers a handler for incoming UDP packets on a specified port.
--- @param port number The port to register the handler for.
--- @param handler function The function to call when a UDP packet is received.
--- @return boolean result true if the handler was registered successfully, false otherwise.
function cc_socket.register_udp_handler(port, handler)
  if type(port) ~= "number" or type(handler) ~= "function" then
    error("Invalid arguments: port must be a number and handler must be a function.")
  end
  local event = { "network_syscall", "register_udp_handler", port, handler }
  os.queueEvent(table.unpack(event))
  local ev = { os.pullEvent("network_response") }
  return ev[1] == true
end

--- Unregisters a handler for incoming UDP packets on a specified port.
--- @param port number The port to unregister the handler for.
--- @return boolean result true if the handler was unregistered successfully, false otherwise.
function cc_socket.unregister_udp_handler(port)
  if type(port) ~= "number" then
    error("Invalid argument: port must be a number.")
  end
  local event = { "network_syscall", "unregister_udp_handler", port }
  os.queueEvent(table.unpack(event))
  local ev = { os.pullEvent("network_response") }
  return ev[1] == true
end

return cc_socket