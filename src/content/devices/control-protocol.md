---
title: "Device control protocol: describe, telemetry, state, config and commands"
nav: "Control protocol"
description: "How a Paqett IP device describes its own metrics, settings and commands over MQTT, sends telemetry, reports state, takes desired config and acks commands."
tldr: "A Paqett IP device describes itself on a retained describe topic: its metrics, its config keys as typed FieldSpecs and its commands. It sends readings on telemetry, reports the config it runs on a retained state, applies the retained desired set on config, and answers cmd/name with cmd_ack. The platform and console work only from that description."
order: 4
updated: 2026-11-24
keywords: [iot device shadow mqtt, desired reported state mqtt, mqtt device configuration protocol, mqtt command acknowledgement, self describing iot device, mqtt telemetry json format]
about: [mqtt, json, digital-twin]
---

The control protocol is how a Paqett IP device tells the platform what it is and how the platform configures it and sends it commands. It runs over the same MQTT session as everything else, under `devices/<device id>/`. This page is protocol v1 in full: every topic, payload, rule and limit, with the payloads a real ESP32-C6 sends.

The platform and the console know nothing about a particular device. There is no LED code, no sensor list and no settings schema for your board anywhere in Paqett. The device **describes itself**, and the platform stores, decodes and validates everything from that description. A new metric, setting or command is a firmware change only.

## How it works

Five topics make up the protocol. Two are the device shadow: the desired config the platform wants (`config`) and the config the device reports it runs (`state`).

```text
device                                              platform
  |-- describe  (retained) metrics, config, commands -->|
  |-- telemetry            readings ------------------->|  samples
  |-- state     (retained) version, reported, errors -->|  reported
  |<-- config   (retained) version, desired ------------|  desired
  |<-- cmd/<name>          id, args --------------------|
  |-- cmd_ack              id, cmd, ok, result|error -->|  command log
```

| Topic | Direction | QoS, retain | Payload |
| --- | --- | --- | --- |
| `describe` | device to platform | 1, retained | `version`, `metrics`, `config`, `commands` |
| `telemetry` | device to platform | 1, not retained | A JSON object of readings, optional `ts` |
| `state` | device to platform | 1, retained | `version`, `reported`, optional `errors` |
| `config` | platform to device | 1, retained | `version`, `desired` |
| `cmd/<name>` | platform to device | 1, not retained | `id`, `args` |
| `cmd_ack` | device to platform | 1, not retained | `id`, `cmd`, `ok`, optional `result` or `error` |

The size limits are under [Payload limits](#payload-limits).

All of these are under `devices/<device id>/`, and the broker lets a device use nothing outside that prefix. The full topic list, with `status`, `hello` and OTA, is on [MQTT topics](/devices/mqtt-topics).

## On every connect

1. Publish `{"online":true}` to `status`, retained.
2. Subscribe to `cmd/#`, `ota` and `config`, all QoS 1.
3. Publish `describe`, retained.
4. Publish `hello`.
5. Publish `state`, retained.

`describe` goes before `hello`, so whatever reacts to the hello already knows what the device is. Subscribing to `config` delivers the retained desired set straight away. The device applies it and publishes `state` again. Publish `describe` and `state` on every connect, even when nothing has changed: the broker refuses everything for a moment while it starts, so a publish sent in that window is lost. Publishing again on every connect makes up for it.

An OTA image on trial confirms itself only after the hello, as described on [OTA updates](/devices/ota).

## describe

`describe` is the device's description of itself. It is published retained at QoS 1 on every connect:

```json
{
  "version": 1,
  "metrics":  { "<metric>": { "label": "Chip temperature", "unit": "°C", "description": "..." } },
  "config":   { "<key>": FieldSpec },
  "commands": { "<name>": { "label": "Blink the LED", "description": "...", "args": { "<arg>": FieldSpec } } }
}
```

`version` is the protocol version, an integer from 1. `metrics`, `config`, `commands` and a command's `args` may each be left out, which means empty. A metric entry has a `label` and an optional `unit` and `description`. A command has a `label`, an optional `description` and its `args`.

### Names

Config keys, command names, argument names and metric names all follow one pattern: `^[a-z0-9_]+(\.[a-z0-9_]+)*$`, at most 64 characters. That is lower-case letters, digits and underscores, in segments joined by dots: `led.brightness`, `telemetry.interval_s`. A metric name must also start with a letter, `^[a-z][a-z0-9_.]{0,63}$`.

Use the dots to group. A key such as `led.colour` and a metric such as `led.brightness` nest in the JSON the device sends: the platform flattens them back with `.` (see [telemetry](#telemetry)).

### FieldSpec

Every config key and every command argument is a FieldSpec, a typed field with its limits:

| Field | Type | Applies to | Meaning |
| --- | --- | --- | --- |
| `type` | string | all | `integer`, `number`, `boolean`, `string`, `enum` or `colour` |
| `label` | string | all | What the console shows, 1 to 128 characters |
| `description` | string | all, optional | Help text, at most 1024 characters |
| `unit` | string | all, optional | `s`, `ms`, `°C`, at most 32 characters |
| `min`, `max` | number | `integer`, `number` only | Inclusive bounds; `min` ≤ `max` |
| `step` | number | `integer`, `number` only | Values must sit on this step, counted from `min` (or 0); greater than 0 |
| `values` | array of strings | `enum` only, required | The allowed values: 1 to 64 distinct strings |
| `max_length` | integer | `string` only | 1 to 1024 characters |
| `default` | value | all, optional | The device's default; it must pass its own FieldSpec |

The platform checks the shape strictly. `min`, `max` and `step` appear only on `integer` and `number`, `values` only and always on `enum`, and `max_length` only on `string`. A `default` must be a value its own FieldSpec accepts, and unknown fields are refused anywhere in the document.

### Field types

| Type | On the wire | Accepted |
| --- | --- | --- |
| `integer` | JSON integer | Within `min` and `max`, on `step` |
| `number` | JSON number | Finite, the same bounds and step (binary fractions allowed for: 0.3 is on a 0.1 step) |
| `boolean` | `true` or `false` | Either |
| `string` | JSON string | At most `max_length` characters, 1024 when not given |
| `enum` | JSON string | One of `values` |
| `colour` | JSON string | `#rrggbb` in lower-case hex; the platform accepts upper case and sends it lower-case |

### Limits

| What | At most |
| --- | --- |
| Config keys | 64 |
| Commands | 32, each with 32 arguments |
| Metrics | 128 |
| Name of a key, command, argument or metric | 64 characters |
| `label` | 128 characters (and at least 1) |
| `description` | 1024 characters |
| `unit` | 32 characters |
| Enum `values` | 64 distinct |
| The whole `describe` message | 64 KiB |

A `describe` that breaks a rule is refused as a whole, and the device's previous description stays in place. The stored description is the device's own, in its own order: the console shows fields in the order the device lists them.

### The ESP32-C6 describe

This is the `describe` the Paqett SDK's ESP32-C6 firmware (0.4.0) publishes, pretty-printed. On the wire it is one line of about 2.2 KB:

```json
{
  "version": 1,
  "metrics": {
    "uptime_s": { "label": "Uptime", "unit": "s", "description": "Time since the last boot." },
    "rssi_dbm": { "label": "Wi-Fi signal", "unit": "dBm", "description": "Signal strength of the access point." },
    "heap_free_bytes": { "label": "Free heap", "unit": "B", "description": "Free RAM." },
    "temp_c": { "label": "Chip temperature", "unit": "°C", "description": "ESP32-C6 internal sensor: the die, not the room." },
    "wifi_reconnects": { "label": "Wi-Fi reconnects", "description": "Times Wi-Fi has come back since boot." },
    "led.brightness": { "label": "LED brightness", "description": "Current LED brightness (0 when the LED is off)." }
  },
  "config": {
    "telemetry.enabled": {
      "type": "boolean", "label": "Telemetry",
      "description": "Send readings on devices/<id>/telemetry.", "default": true
    },
    "telemetry.interval_s": {
      "type": "integer", "label": "Telemetry interval",
      "description": "Seconds between readings. A change applies at once.",
      "unit": "s", "min": 5, "max": 3600, "default": 30
    },
    "led.mode": {
      "type": "enum", "label": "LED mode",
      "description": "rainbow: the colour wheel; solid: LED colour; breathe: LED colour fading in and out; off: dark.",
      "values": ["rainbow", "solid", "breathe", "off"], "default": "rainbow"
    },
    "led.colour": {
      "type": "colour", "label": "LED colour",
      "description": "Used by solid and breathe.", "default": "#00ffaa"
    },
    "led.brightness": {
      "type": "integer", "label": "LED brightness",
      "description": "Peak channel value (0-255); scales every mode.", "min": 0, "max": 255, "default": 40
    },
    "led.period_ms": {
      "type": "integer", "label": "LED period",
      "description": "One turn of the rainbow, or one breath.", "unit": "ms", "min": 500, "max": 60000, "default": 4000
    }
  },
  "commands": {
    "reboot": {
      "label": "Reboot",
      "description": "Acknowledges, then restarts the device about half a second later.", "args": {}
    },
    "led.blink": {
      "label": "Blink the LED",
      "description": "Flashes the LED (200 ms on, 200 ms off), then returns to the configured mode.",
      "args": {
        "colour": { "type": "colour", "label": "Colour", "default": "#ffffff" },
        "times": { "type": "integer", "label": "Times", "min": 1, "max": 20, "default": 3 }
      }
    },
    "ping": {
      "label": "Ping",
      "description": "Answers at once with the uptime: proves the device is listening.", "args": {}
    },
    "telemetry.now": {
      "label": "Send telemetry now",
      "description": "Publishes one telemetry message at once, whatever the interval.", "args": {}
    }
  }
}
```

The same name can be a config key and a metric. Here `led.brightness` is both the setting (the peak brightness) and a reading (what the LED shows now, 0 when it is off).

## telemetry

`telemetry` carries readings: a JSON object, QoS 1, not retained, at most 16 KiB. The device chooses its own interval. On the ESP32-C6 the interval is a config key like any other (`telemetry.interval_s`).

```json
{"ts":1795521600123,"uptime_s":812,"rssi_dbm":-61,"heap_free_bytes":231480,"temp_c":31.4,"wifi_reconnects":0,"led":{"brightness":40}}
```

What becomes a metric:

- **Numbers** become samples under their name.
- **Booleans** become samples too: 1 for true, 0 for false. Samples are numbers.
- **Nested objects** are flattened with `.`: `{"led":{"brightness":40}}` is the metric `led.brightness`.
- **Strings, arrays and nulls** are kept in the stored raw message, but they are not metrics.
- **Names** are taken as sent and never rewritten. One that breaks the naming rules is skipped, and the rest of the message is still decoded.

Every value is stored; there is no store-on-change. A metric does not have to be in `describe` to be stored. Declaring it gives it the label, unit and description the console shows in its place of the bare key.

### ts

`ts` is reserved, top level only: the time of the readings in Unix milliseconds. It is optional; leave it out while the device clock is not set (before SNTP has run, say). The platform uses `ts` as the sample time when it lies within 7 days before and 5 minutes after the moment the message arrived. Otherwise, and when `ts` is absent, the sample time is the time the platform received the message.

## state

`state` is the reported half of the shadow: the config the device runs now. It is published retained at QoS 1 on every connect and after every config message the device applies:

```json
{"version":0,"reported":{"telemetry.enabled":true,"telemetry.interval_s":30,"led.mode":"rainbow","led.colour":"#00ffaa","led.brightness":40,"led.period_ms":4000}}
```

| Field | Meaning |
| --- | --- |
| `version` | The `config` version the device last applied; 0 if it has never had one |
| `reported` | The current value of **every** config key the device has, defaults included |
| `errors` | Optional: a reason for each desired value the device refused, by key |

`reported` and `errors` hold at most 64 keys each, and the message at most 16 KiB.

When the reported `version` is behind the desired one, the platform publishes `config` again. It waits until the desired set is 30 seconds old and does this at most every 5 minutes per device. So a config publish that never reached the device is put right when the device next connects.

## config

`config` is the desired half of the shadow. The platform publishes it retained at QoS 1 on `devices/<device id>/config`:

```json
{"version":7,"desired":{"led.mode":"solid","led.colour":"#ff8800","telemetry.interval_s":60}}
```

The rules the device follows:

- **`desired` is the full desired set.** It holds only the keys someone has set, not every key the device has.
- **Absent or `null` means the device default.** A key left out of `desired`, or set to `null`, goes back to its default. That is how "reset to default" works: the platform drops the key from the desired set and publishes the whole set again. A set emptied key by key is published as `{"version":8,"desired":{}}`.
- **Check every value against your own FieldSpec.** Apply the valid ones. An invalid value keeps the current value and is reported in `state.errors`.
- **Ignore keys you do not know.**
- **Colours are lower-case.** The platform always sends `#rrggbb` in lower-case hex, whatever case someone typed.
- **Keep the applied values across reboots,** in NVS on an ESP32, and boot with them.
- **Then publish `state`** with `version` set to this message's version.

`version` goes up by one on every change. The device echoes it in `state` as given. It is not a sequence number to order messages by. A device re-enrolled on another platform must follow that platform's numbering, even if it is lower.

The platform checks every value against the device's latest `describe` before it publishes, so a refusal from the device is rare. It happens when the firmware changes under a desired set: a new image narrows a range or drops an enum value. This is what the ESP32-C6 publishes after a `config` with an out-of-range brightness and a key it does not have:

```json
{"version":7,"desired":{"led.mode":"solid","led.colour":"#ff8800","led.brightness":400,"telemetry.interval_s":60,"unknown.key":1}}
```

```json
{"version":7,"reported":{"telemetry.enabled":true,"telemetry.interval_s":60,"led.mode":"solid","led.colour":"#ff8800","led.brightness":40,"led.period_ms":4000},"errors":{"led.brightness":"above the maximum 255"}}
```

`led.brightness` kept its value, `unknown.key` was ignored, and the rest took effect.

An empty retained payload on `config` means the broker's retained message was cleared. It is not a config: ignore it and keep the current values.

## Commands: cmd/name and cmd_ack

The platform sends a command on `devices/<device id>/cmd/<name>`, QoS 1, not retained:

```json
{"id":"b1e0c2d4-5f6a-4b7c-8d9e-0a1b2c3d4e5f","args":{"times":3}}
```

The device checks the arguments against the command's FieldSpecs, acts, and answers on `cmd_ack` (QoS 1, at most 8 KiB) with the same `id`:

```json
{"id":"b1e0c2d4-5f6a-4b7c-8d9e-0a1b2c3d4e5f","cmd":"led.blink","ok":true,"result":{"colour":"#ffffff","times":3}}
```

| Field | Meaning |
| --- | --- |
| `id` | The command's id, copied from the command. The platform sends a UUID; the SDK accepts any string of 1 to 128 characters. |
| `cmd` | The command name, from the topic |
| `ok` | `true` if the command was carried out |
| `result` | Optional, any JSON: what the command returns |
| `error` | When `ok` is false: why |

Arguments the platform leaves out are not filled in by the platform. The device uses its own defaults for them, and an argument without a default that is missing is an error. Unknown arguments are ignored.

Commands are fire-and-forget on the wire. The platform records the ack, or the lack of one. The first ack for an id wins. An ack for another device's command, or for an id the platform never sent, changes nothing.

Answer every command, including the ones you cannot carry out, so the platform is never left waiting. Ack before you act on anything that ends the session: the ESP32-C6's `reboot` acks with `{"in_ms":500}` and restarts half a second later.

### Errors

| `error` | When |
| --- | --- |
| `unknown_command` | The device has no command by that name |
| `invalid_payload: <reason>` | The payload is not a JSON object, `id` is not a string of 1 to 128 characters, or `args` is not an object |
| `invalid_args: <arg>: <reason>` | An argument failed its FieldSpec, or is missing and has no default |
| Your own text | The command could not be carried out; the ESP32-C6's `telemetry.now` answers `offline` when it cannot publish the reading |

What the ESP32-C6 answers:

```json
{"id":"c2f1d3e5-6a7b-4c8d-9e0f-1a2b3c4d5e6f","cmd":"led.blink","ok":false,"error":"invalid_args: times: above the maximum 20"}
{"id":"d3a2e4f6-7b8c-4d9e-0f1a-2b3c4d5e6f70","cmd":"led.blink","ok":false,"error":"invalid_args: colour: expected a colour #rrggbb (lower-case hex)"}
{"id":"e4b3f5a7-8c9d-4e0f-1a2b-3c4d5e6f7081","cmd":"dance","ok":false,"error":"unknown_command"}
{"id":"3f6c1d2e-8a4b-4c1e-9f0a-2b7d5e6a9c10","cmd":"ping","ok":true,"result":{"uptime_s":812}}
```

### The legacy ping

Before protocol v1, commands carried no id. `cmd/ping` with the payload `{}` still gets the old answer, with no `id` and no `result`:

```json
{"cmd":"ping","ok":true}
```

A command without an id is answered in this shape whatever its name, so a device that knows nothing of v1 still answers `{"cmd":"reboot-into-dfu","ok":false,"error":"unknown_command"}`.

## Payload limits

| Message | Limit |
| --- | --- |
| `describe` | 64 KiB; 64 config keys, 32 commands of 32 args, 128 metrics |
| `telemetry` | 16 KiB |
| `state` | 16 KiB; 64 keys in `reported`, 64 in `errors` |
| `cmd_ack` | 8 KiB |
| Command `id` | 128 characters |
| Any name | 64 characters |

Size your MQTT client's buffer for the largest message you send. esp-mqtt defaults to 1024 bytes; the Paqett SDK sets 4096 so the ESP32-C6's describe of about 2.2 KB goes out in one buffer.

## How the console uses it

The console builds every screen for an IP device from its `describe`:

- **Readings, Overview and Data** label every metric with the device's own `label`, `unit` and `description`, for every member of the project: "Chip temperature" in °C for `temp_c`, "Free heap" in B for `heap_free_bytes`. A metric the device did not describe keeps a label made from its key.
- **The State tab** has one row per config key, in the device's order: its label, key and description, then Reported, Desired and Status. The Desired control follows the FieldSpec: a number field (with a slider when both bounds are known), a switch, a select, a colour picker with a hex field, or a text field limited to `max_length`. A value outside its FieldSpec is flagged on its row and cannot be applied. Applying sends only the changed keys; resetting a key to the device default sends `null`. Each row's status is one of Not applied yet, Pending, Refused by the device (with the reason from `state.errors`), In sync, or Device's own value (nothing desired). The header shows `Desired vN · reported vM`.
- **Commands** are one card per declared command, with an argument form built from its FieldSpecs and the defaults filled in. The log below lists each command sent, its arguments, who sent it and the answer: done with its `result`, failed with its `error`, waiting, or no answer after 60 seconds.

Changing config and sending commands is done by Paqett staff today. Both will open to a project's owners and admins, with a project API key scope for doing the same from your own code. Every config change and command is recorded in the organisation's audit log.

## Adding a setting, command or metric

Change the firmware and nothing else:

1. Add the key, command or metric to what the device declares.
2. Flash it, or ship it [over the air](/devices/ota).
3. On its next connect the device publishes the new `describe`, and the console shows the new row, card or reading.

Removing one works the same way. A desired value for a key the new firmware no longer has is ignored by the device, and the console stops offering it.

For the device side on an ESP32, with code, see [ESP32 device shadow over MQTT](/guides/esp32-device-shadow-config-commands).

## FAQ

### What is a device shadow?

A device shadow is a stored copy of a device's configuration in two halves: the desired values someone wants and the values the device reports it runs. On Paqett the desired half is the retained `config` message and the reported half is the retained `state` message. The difference between them is what is still pending.

### Does the platform need to know my device's settings in advance?

No. The device publishes its config keys, commands and metrics in a retained `describe` message, with a type and limits for every field, and the platform and console work from that alone. A new setting is a firmware change only.

### What happens to config sent while the device is offline?

It waits on the broker. `config` is retained, so the device receives the latest desired set as soon as it subscribes on its next connect. If the device's reported version is still behind, the platform publishes the desired set again, at most every 5 minutes.

### How does a device reset a setting to its default?

It does not have to do anything special. When a key is reset, the platform removes it from the desired set (or sends it as `null`), and a key that is absent or `null` goes back to the device's own default. The device then reports the default in `state`.

### Why is telemetry not retained?

Telemetry is a stream of readings, and every message is stored as samples. A retained reading would be delivered again to every new subscriber as if it were new. The retained topics are the ones that describe the device's current condition: `status`, `describe` and `state`.

### Can a string or an array be a metric?

No. Only numbers and booleans become samples; booleans are stored as 1 and 0. Strings, arrays and nulls stay in the stored raw message, so nothing is lost, but they are not charted.

### How does the device know which command an ack belongs to?

It does not need to. The device copies the command's `id` into its `cmd_ack`, and the platform matches the ack to the command by that id. The first ack for an id wins.

## Sources

- [MQTT Version 3.1.1 (OASIS Standard)](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html): retained messages, QoS 1 and topic filters.
- [MQTT Version 5.0 (OASIS Standard)](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html): the current MQTT specification.
- [RFC 8259: The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259): the payload format of every message on this page.
- [AWS IoT Device Shadow service](https://docs.aws.amazon.com/iot/latest/developerguide/iot-device-shadows.html): the desired and reported state model on AWS IoT Core, for comparison.
- [Azure IoT Hub device twins](https://learn.microsoft.com/en-us/azure/iot-hub/iot-hub-devguide-device-twins): desired and reported properties on Azure IoT Hub, for comparison.
