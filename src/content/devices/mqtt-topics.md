---
title: "MQTT topics and payloads for Paqett devices"
nav: "MQTT topics"
description: "Every MQTT topic a Paqett device uses over mutual TLS: status, hello, describe, telemetry, state, config, commands and OTA, with QoS, retain and ACL."
tldr: "A Paqett device connects to mqtt.paqett.com:8883 with its client certificate and may only use topics under devices/ plus its device id. On every connect it publishes a retained status, a retained describe, a hello and a retained state. It sends readings on telemetry, takes desired config on config, answers cmd/name on cmd_ack and takes OTA offers on ota."
order: 3
updated: 2026-11-24
keywords: [mqtt topic structure iot, mqtt last will retained status, mqtt device commands, mqtt acl per device, mqtt topics esp32, mqtt device shadow topics]
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

| Topic | Published by | QoS, retain | Payload |
| --- | --- | --- | --- |
| `status` | device; the broker as the will | 1, retained | `{"online":true}` on connect; `{"online":false}` when the connection drops |
| `hello` | device, on every connect | 1 | `hardware_id`, `model`, `firmware`, `reset_reason`, `uptime_ms`, `rssi`, `ip` |
| `describe` | device, on every connect before `hello` | 1, retained | The device's metrics, config keys and commands. See [Control protocol](/devices/control-protocol#describe). |
| `telemetry` | device | 1 | Readings: a JSON object of numbers and booleans, optional `ts`. See [Control protocol](/devices/control-protocol#telemetry). |
| `state` | device, on connect and after every config | 1, retained | `version`, `reported`, optional `errors`: the config the device runs |
| `config` | platform | 1, retained | `version`, `desired`: the desired config |
| `cmd/<name>` | platform | 1 | A command, `id` and `args` |
| `cmd_ack` | device | 1 | `id`, `cmd`, `ok`, and `result` or `error` |
| `ota` | platform | 1, retained | A firmware update offer, or empty when there is none. See [OTA updates](/devices/ota). |
| `ota_status` | device | 1 | How an update is going. See [OTA updates](/devices/ota). |

`describe`, `telemetry`, `state`, `config`, `cmd/<name>` and `cmd_ack` are the [control protocol](/devices/control-protocol): `config` and `state` are the device shadow, the desired and the reported config.

## Who may use which topic

The broker's ACL lets a device publish and subscribe to `devices/<its own id>/#` and nothing else. The id comes from the common name of the certificate it connected with, so one device can never read or write another's topics, whatever topic string it builds.

| Client | Subscribes to | Publishes to |
| --- | --- | --- |
| A device | `cmd/#`, `ota`, `config` under its own prefix | `status`, `hello`, `describe`, `telemetry`, `state`, `cmd_ack`, `ota_status` under its own prefix |
| The platform | `devices/+/hello`, `status`, `ota_status`, `telemetry`, `describe`, `state`, `cmd_ack` | `devices/+/ota`, `devices/+/config`, `devices/+/cmd/#` |

`cmd_ack` sits outside `cmd/#` on purpose, so a device subscribed to its commands never hears its own acknowledgements.

## On every connect

1. Publish `{"online":true}` to `status`, retained, so anything that subscribes later sees the device as online.
2. Subscribe to `cmd/#`, `ota` and `config`.
3. Publish `describe`, retained.
4. Publish a `hello`.
5. Publish `state`, retained.

The order matters. `describe` goes first so whatever reacts to the hello already knows what the device is. A device subscribed to `ota` before it says hello receives any waiting offer, and the platform re-sends an unfinished offer with a fresh download link when it sees the hello. Subscribing to `config` delivers the retained desired config, which the device applies before it publishes `state` again.

### hello

```json
{
  "hardware_id": "esp32c6-40ac1b2c3d4e",
  "model": "esp32c6-devkit",
  "firmware": "0.4.0",
  "reset_reason": "poweron",
  "uptime_ms": 5120,
  "rssi": -61,
  "ip": "192.168.1.42"
}
```

The platform records the device's presence and last hello, and takes its firmware version from `firmware`. That is also how it decides whether an OTA update took: the next hello after an update reports the version the device came back on.

## Commands

The platform publishes a command on `cmd/<name>` with an `id`; the device answers on `cmd_ack` with the same `id`:

```json
{"id":"3f6c1d2e-8a4b-4c1e-9f0a-2b7d5e6a9c10","cmd":"ping","ok":true,"result":{"uptime_s":812}}
```

A command the device does not know is answered too, so the platform is never left waiting:

```json
{"id":"e4b3f5a7-8c9d-4e0f-1a2b-3c4d5e6f7081","cmd":"dance","ok":false,"error":"unknown_command"}
```

The pre-v1 `cmd/ping` with the payload `{}` carries no id and still gets `{"cmd":"ping","ok":true}`. The arguments, the errors and the rest are on [Control protocol](/devices/control-protocol#commands-cmdname-and-cmd_ack).

## Disconnecting cleanly

Before a planned disconnect (a reboot into new firmware, say), publish `{"online":false}` to `status` yourself, retained. The broker only sends the will when a connection drops without a clean disconnect.

## FAQ

### Which port does Paqett MQTT use?

Port 8883, MQTT over TLS, at mqtt.paqett.com. Devices authenticate with their client certificate during the TLS handshake.

### Do I need an MQTT username and password?

No. The broker takes the MQTT username and client id from the common name of the device's certificate, whatever the client sends.

### Which MQTT topics are retained?

`status`, `describe`, `state`, `config` and `ota`. They hold the device's current condition: whether it is online, what it is, the config it runs, the config it should run, and any firmware offer. Telemetry, hello, commands and acknowledgements are not retained.

### What happens if a device publishes outside its own topic prefix?

The broker's ACL lets a device use only topics under its own prefix, so the publish or subscribe is refused. Build every topic from the topic_prefix the provisioning response returned.

### Why is the status topic retained?

So any subscriber that connects later sees the device's last state straight away. The broker's last will publishes a retained offline status when the connection drops without a clean disconnect.

## Sources

- [MQTT Version 3.1.1 (OASIS Standard)](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html): retained messages, last will, QoS 1 and topic filters.
- [MQTT Version 5.0 (OASIS Standard)](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html): the current MQTT specification, including CONNACK reason codes.
- [IANA Service Name and Port Number Registry: 8883](https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml?search=8883): port 8883 registered for MQTT over TLS.
