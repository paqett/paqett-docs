---
title: "MQTT topics and payloads for Paqett devices"
nav: "MQTT topics"
description: "The MQTT topics a Paqett device publishes and subscribes to over mutual TLS: status, hello, commands and OTA, with payloads, QoS and retain flags."
tldr: "A Paqett device connects to mqtt.paqett.com:8883 with its client certificate and may only use topics under devices/ plus its device id. It publishes a retained status and a hello on every connect, answers commands on cmd/name via cmd_ack, receives retained OTA offers on ota and reports progress on ota_status."
order: 3
updated: 2026-11-19
keywords: [mqtt topic structure iot, mqtt last will retained status, mqtt device commands, mqtt acl per device, mqtt topics esp32]
about: [mqtt, mtls, tls]
---

A device connects to `mqtt.paqett.com:8883` with its client certificate. The broker takes the device id from the certificate's common name and uses it as the MQTT username and client id, whatever the client sends. The device may then publish and subscribe under `devices/<device id>/` and nowhere else.

## Connecting

| Setting | Value |
| --- | --- |
| Host, port | `mqtt.paqett.com`, `8883` |
| TLS | Verify the broker with `ca_pem` from provisioning (hostname check on); present `cert_pem` and the device's key |
| Client id | The device id. The broker sets it from the certificate either way. |
| Username, password | None needed |
| Last will | `devices/<device id>/status`, payload `{"online":false}`, retained, QoS 1 |

## Topics

All topics are under `devices/<device id>/`.

| Topic | Direction | QoS, retain | Payload |
| --- | --- | --- | --- |
| `status` | device, and the broker as the will | 1, retained | `{"online":true}` on connect; `{"online":false}` when the connection drops |
| `hello` | device, on every connect | 1 | `hardware_id`, `model`, `firmware`, `reset_reason`, `uptime_ms`, `rssi`, `ip` |
| `telemetry` | device | 1 | Readings, in your device's own format |
| `cmd/<name>` | platform | 1 | A command |
| `cmd_ack` | device | 1 | `cmd`, `ok`, and anything the command returns |
| `ota` | platform | 1, retained | A firmware update offer, or empty when there is none. See [OTA updates](/devices/ota). |
| `ota_status` | device | 1 | How an update is going. See [OTA updates](/devices/ota). |

## On every connect

1. Publish `{"online":true}` to `status`, retained, so anything that subscribes later sees the device as online.
2. Subscribe to `cmd/#` and `ota`.
3. Publish a `hello`.

The order matters for OTA: a device subscribed to `ota` before it says hello receives any waiting offer, and the platform re-sends an unfinished offer with a fresh download link when it sees the hello.

### hello

```json
{
  "hardware_id": "esp32c6-40ac1b2c3d4e",
  "model": "esp32c6-devkit",
  "firmware": "0.3.0",
  "reset_reason": "poweron",
  "uptime_ms": 5120,
  "rssi": -61,
  "ip": "192.168.1.42"
}
```

The platform records the device's presence and last hello, and takes its firmware version from `firmware`. That is also how it decides whether an OTA update took: the next hello after an update reports the version the device came back on.

## Commands

The platform publishes a command on `cmd/<name>`; the device answers on `cmd_ack`. `cmd/ping` is the one every device answers:

```json
{"cmd":"ping","ok":true}
```

A command the device does not know is answered too, so the platform is never left waiting:

```json
{"cmd":"reboot-into-dfu","ok":false,"error":"unknown_command"}
```

## Disconnecting cleanly

Before a planned disconnect (a reboot into new firmware, say), publish `{"online":false}` to `status` yourself, retained. The broker only sends the will when a connection drops without a clean disconnect.

## FAQ

### Which port does Paqett MQTT use?

Port 8883, MQTT over TLS, at mqtt.paqett.com. Devices authenticate with their client certificate during the TLS handshake.

### Do I need an MQTT username and password?

No. The broker takes the MQTT username and client id from the common name of the device's certificate, whatever the client sends.

### What happens if a device publishes outside its own topic prefix?

The broker's ACL lets a device use only topics under its own prefix, so the publish or subscribe is refused. Build every topic from the topic_prefix the provisioning response returned.

### Why is the status topic retained?

So any subscriber that connects later sees the device's last state straight away. The broker's last will publishes a retained offline status when the connection drops without a clean disconnect.

## Sources

- [MQTT Version 3.1.1 (OASIS Standard)](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html): retained messages, last will, QoS 1 and topic filters.
- [MQTT Version 5.0 (OASIS Standard)](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html): the current MQTT specification, including CONNACK reason codes.
- [IANA Service Name and Port Number Registry: 8883](https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml?search=8883): port 8883 registered for MQTT over TLS.
