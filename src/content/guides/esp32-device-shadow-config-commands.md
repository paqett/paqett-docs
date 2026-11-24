---
title: "ESP32 device shadow over MQTT: desired vs reported config and commands"
nav: "ESP32: device shadow and commands"
description: "Give an ESP32 a device shadow over MQTT: declare typed settings, commands and metrics, apply desired config, keep it in NVS, report state and ack commands."
tldr: "An ESP32 gets a device shadow over MQTT by publishing a retained describe of its typed settings, commands and metrics, applying the retained desired config the platform sends, keeping the values in NVS, publishing the values it runs as a retained state, and answering every cmd/name on cmd_ack with the command's id."
order: 3
updated: 2026-11-24
keywords: [esp32 device shadow, esp32 mqtt configuration, desired reported state esp32, esp32 mqtt commands, esp32 nvs settings, esp32 remote config mqtt]
about: [esp32, mqtt, nvs, json, digital-twin, arduino, esp-idf]
---

By the end of this guide your ESP32 has a device shadow on Paqett. It tells the platform which settings it has, with a type and limits for each, which commands it takes and which readings it sends. The console then shows its readings by name and unit, a row for every setting with the desired and reported value side by side, and a card for every command. None of that needs a change on the platform: the device's own description drives it.

The code comes from the Paqett SDK's ESP32-C6 firmware (Arduino-ESP32 3.1.3 on ESP-IDF 5.3, built with pioarduino). The protocol itself is plain JSON over MQTT, and a later section shows the same thing with esp-mqtt and cJSON, without the SDK.

## What you need

- An ESP32 connected to the Paqett broker over mutual TLS. If yours is not, start with [the mTLS guide](/guides/esp32-mqtt-mutual-tls-x509).
- A JSON library. The SDK has its own small one; cJSON ships with ESP-IDF 5.x.
- The [control protocol reference](/devices/control-protocol) open in another tab, for the exact rules and limits.

## How the device shadow works

A device shadow is two copies of the device's settings: the **desired** values someone set, and the **reported** values the device actually runs. On Paqett both are retained MQTT messages under `devices/<id>/`:

| Topic | Who publishes | What it holds |
| --- | --- | --- |
| `describe` | the device, retained | Every metric, setting and command, with a FieldSpec (type, label, unit, limits, default) for each setting and argument |
| `config` | the platform, retained | The desired set: `version` and `desired`, only the keys someone has set |
| `state` | the device, retained | The reported set: `version` applied, every key's current value, and `errors` for refused values |
| `telemetry` | the device | Readings |
| `cmd/<name>`, `cmd_ack` | the platform, then the device | A command with an `id`, and the answer with the same `id` |

Because `config` is retained, a device that was offline when someone changed a setting gets the change the moment it subscribes. Because `state` is retained, the platform always knows what the device runs, and the console shows a setting as pending until the reported value matches.

## Step 1: Declare the settings

Each setting is a key and a FieldSpec. Keys are lower-case letters, digits and underscores, grouped with dots, at most 64 characters. The type decides the control the console draws: a number field and slider, a switch, a select, a colour picker or a text field.

```cpp
using ipnode::FieldSpec;

g_config.add(FieldSpec::boolean("telemetry.enabled", "Telemetry", true)
                 .describe("Send readings on devices/<id>/telemetry."));
g_config.add(FieldSpec::integer("telemetry.interval_s", "Telemetry interval", 5, 3600, 30)
                 .in_unit("s")
                 .describe("Seconds between readings. A change applies at once."));
g_config.add(FieldSpec::enumeration("led.mode", "LED mode", {"rainbow", "solid", "breathe", "off"}, "rainbow"));
g_config.add(FieldSpec::colour("led.colour", "LED colour", "#00ffaa").describe("Used by solid and breathe."));
g_config.add(FieldSpec::integer("led.brightness", "LED brightness", 0, 255, 40));
```

`add()` refuses a spec that would break the protocol: a bad key, `min` above `max`, an enum without values, a default its own limits reject, or a duplicate. Check its return value while you develop. Each of those lines becomes an entry in `describe`:

```json
"telemetry.interval_s": {
  "type": "integer", "label": "Telemetry interval",
  "description": "Seconds between readings. A change applies at once.",
  "unit": "s", "min": 5, "max": 3600, "default": 30
}
```

Give every setting a default. The default is what the device runs until someone sets a value, and what it goes back to when the value is reset.

## Step 2: Declare the metrics and read them

Metrics need only a name, a label and, optionally, a unit and a description. Declaring them is what makes the console say "Chip temperature, °C" instead of `temp_c`.

```cpp
g_metrics.add({"uptime_s", "Uptime", "s", "Time since the last boot."});
g_metrics.add({"rssi_dbm", "Wi-Fi signal", "dBm", "Signal strength of the access point."});
g_metrics.add({"temp_c", "Chip temperature", "\xC2\xB0" "C", "ESP32-C6 internal sensor: the die, not the room."});
g_metrics.add({"led.brightness", "LED brightness", "", "Current LED brightness (0 when the LED is off)."});
```

The readings themselves come from a `TelemetrySource` the SDK calls on every interval:

```cpp
void read(ipnode::Readings& r, uint64_t now) override {
    r.set_int("uptime_s", static_cast<int64_t>(now / 1000));
    if (WiFi.isConnected()) r.set_int("rssi_dbm", WiFi.RSSI());
    const float t = temperatureRead();
    if (!std::isnan(t)) r.set_number("temp_c", std::round(static_cast<double>(t) * 10.0) / 10.0);
    r.set_int("led.brightness", g_config.get_string("led.mode") == "off" ? 0 : g_config.get_int("led.brightness"));
}
```

A dotted name nests in the JSON and the platform flattens it back, so `led.brightness` goes out as `{"led":{"brightness":40}}` and is stored as `led.brightness`. Leave out a reading you do not have rather than sending a placeholder, as the RSSI line does while Wi-Fi is down. The SDK adds `ts` in Unix milliseconds once SNTP has set the clock, and leaves it out before then:

```json
{"ts":1795521600123,"uptime_s":812,"rssi_dbm":-61,"heap_free_bytes":231480,"temp_c":31.4,"wifi_reconnects":0,"led":{"brightness":40}}
```

## Step 3: Declare the commands

A command is a name, a label, its arguments as FieldSpecs, and a handler that returns a result or an error:

```cpp
ipnode::CommandSpec blink;
blink.name = "led.blink";
blink.label = "Blink the LED";
blink.description = "Flashes the LED (200 ms on, 200 ms off), then returns to the configured mode.";
blink.arg(FieldSpec::colour("colour", "Colour", "#ffffff"));
blink.arg(FieldSpec::integer("times", "Times", 1, 20, 3));
g_commands.add(blink, [](const ipnode::Args& a, uint64_t) {
    uint8_t r = 255, g = 255, b = 255;
    const std::string colour = a.get_string("colour", "#ffffff");
    ipnode::parse_colour(colour, r, g, b);
    const int64_t times = a.get_int("times", 3);
    led_blink(r, g, b, static_cast<uint8_t>(times));
    ipnode::JsonObjectWriter w;
    return ipnode::CommandResult::success(w.str("colour", colour).num("times", times).finish());
});
```

By the time the handler runs, the arguments are checked. A missing argument has its default, and an invalid one never reaches the handler: the SDK answers `invalid_args: times: above the maximum 20` itself.

A command that ends the session must ack first. The SDK publishes the ack as soon as the handler returns, so `reboot` only schedules the restart:

```cpp
g_commands.add(reboot, [](const ipnode::Args&, uint64_t now) {
    g_reboot_at = now + 500;  // after the ack has gone out
    return ipnode::CommandResult::success("{\"in_ms\":500}");
});
```

`ping` and `telemetry.now` are built in; `add_builtin_commands()` in the next step registers them.

## Step 4: Wire the control protocol into the connection

`ipnode::Control` does the protocol: the connect sequence, config, state, commands and the telemetry timer. In `setup()`, after the registries are filled:

```cpp
register_control();                        // steps 1 to 3
g_config.attach_store(&g_config_store);    // NVS, step 5
g_config.load();                           // boot with the stored values
static ipnode::Control control(g_mqtt, g_log, g_config, g_commands, g_metrics, g_telemetry);
control.add_builtin_commands();            // ping, telemetry.now
control.set_on_change(on_config_changed);  // step 5
node.set_control_handler(&control);
```

On every connect the SDK then runs the order the protocol asks for:

1. `status` `{"online":true}`, retained.
2. Subscribe to `cmd/#`, `ota` and `config`.
3. `describe`, retained.
4. `hello`.
5. `state`, retained, then the first telemetry about 2 seconds later.

The retained describe of the ESP32-C6 is about 2.2 KB, more than esp-mqtt's default 1024-byte buffer. The SDK raises it so the message goes out in one piece:

```cpp
cfg.buffer.size = 4096;  // the retained describe is ~2.5 KB; keep it in one buffer
```

## Step 5: Apply desired config and keep it in NVS

The platform publishes the desired set on `devices/<id>/config`:

```json
{"version":7,"desired":{"led.mode":"solid","led.colour":"#ff8800","telemetry.interval_s":60}}
```

`desired` is the whole desired set, not a patch. The device walks its own keys, not the message's: a key that is absent or `null` goes back to its default, a valid value is taken, and an invalid one keeps the current value and is reported. Keys the device does not have are never looked at.

```cpp
for (size_t i = 0; i < specs_.size(); ++i) {
    const FieldSpec& f = specs_[i];
    const JsonSpan* raw = member(desired, f.key);
    Value next;
    if (!raw || json_is_null(*raw)) {
        next = f.initial();  // not (or no longer) desired: back to the default
    } else {
        std::string reason;
        if (!validate_value(f, *raw, next, reason)) {
            errors.emplace_back(f.key, reason);
            continue;  // keep the current value
        }
    }
    if (next != values_[i]) {
        values_[i] = next;
        r.changed.push_back(f.key);
    }
}
```

Then it saves the values, hands the changed keys to the board code and publishes `state` with the version it applied. The whole set is one blob in the NVS namespace `ipn_set`, written only when it differs from what is stored, so a retained config delivered again on every connect does not wear the flash:

```cpp
bool NvsConfigStore::save_config(const std::string& blob) { return nvs_put(kSet, "blob", blob); }
```

```json
{"version":7,"values":{"telemetry.enabled":true,"telemetry.interval_s":60,"led.mode":"solid","led.colour":"#ff8800","led.brightness":40,"led.period_ms":4000}}
```

At boot, `load()` takes every stored value the current FieldSpecs accept and leaves the rest at their defaults. So a new firmware that narrowed a range or dropped a key boots cleanly with the old blob.

The board code reacts to the changed keys. The SDK's registries are not thread-safe, so the ESP32-C6 copies the LED settings into a struct and hands it to its LED task, which reads it under a spinlock:

```cpp
void on_config_changed(const std::vector<std::string>& keys) {
    led_apply(led_settings_from_config());
}
```

The `state` that follows lists every key, defaults included:

```json
{"version":7,"reported":{"telemetry.enabled":true,"telemetry.interval_s":60,"led.mode":"solid","led.colour":"#ff8800","led.brightness":40,"led.period_ms":4000}}
```

A change to `telemetry.interval_s` takes effect at once: the SDK moves the next reading instead of waiting out the old interval.

## Step 6: Answer every command on cmd_ack

A command arrives on `devices/<id>/cmd/<name>` with an `id` and its arguments:

```json
{"id":"b1e0c2d4-5f6a-4b7c-8d9e-0a1b2c3d4e5f","args":{"times":3}}
```

The SDK validates the arguments, runs the handler and publishes the answer on `devices/<id>/cmd_ack` with the same `id`:

```json
{"id":"b1e0c2d4-5f6a-4b7c-8d9e-0a1b2c3d4e5f","cmd":"led.blink","ok":true,"result":{"colour":"#ffffff","times":3}}
```

Every command gets an answer, including the ones that fail, so nothing waits for an ack that never comes:

| Case | `error` |
| --- | --- |
| No such command | `unknown_command` |
| The payload is not a JSON object, or `id` or `args` has the wrong type | `invalid_payload: not a JSON object` |
| An argument out of range, of the wrong type or missing without a default | `invalid_args: times: above the maximum 20` |
| The handler failed | whatever the handler returned, `offline` for instance |

A command without an `id` is the pre-v1 shape. The SDK answers it the old way, `{"cmd":"ping","ok":true}`, so older tools keep working.

## Step 7: Check it on the serial console

The SDK logs every step of the protocol at 115200 baud. A healthy connect, a config change and a command look like this:

```text
[ipnode] control: describe sent (2252 bytes, 6 config keys, 4 commands, 6 metrics)
[ipnode] mqtt: hello sent {"hardware_id":"esp32c6-40ac1b2c3d4e","model":"esp32c6-devkit","firmware":"0.4.0",...}
[ipnode] control: state sent {"version":0,"reported":{"telemetry.enabled":true,...}}
[ipnode] control: config version 7 applied: 3 changed, 0 refused
[ipnode] config: telemetry.interval_s = 60
[ipnode] config: led.mode = "solid"
[ipnode] config: led.colour = "#ff8800"
[ipnode] control: state sent {"version":7,"reported":{...}}
[ipnode] control: cmd led.blink payload={"id":"b1e0c2d4-...","args":{"times":3}}
[ipnode] control: cmd_ack sent {"id":"b1e0c2d4-...","cmd":"led.blink","ok":true,"result":{"colour":"#ffffff","times":3}}
```

`show` on the console prints the config version and every key's current value, with any refused values underneath.

## Without the SDK: esp-mqtt and cJSON

The protocol needs nothing from the SDK. With esp-mqtt and cJSON, a command handler that always answers looks like this:

```cpp
#include <cJSON.h>
#include <math.h>

// A message on devices/<id>/cmd/<name>: answer on devices/<id>/cmd_ack, whatever happens.
static void handle_command(esp_mqtt_client_handle_t c, const char* name, const char* data, int len) {
    cJSON* req = cJSON_ParseWithLength(data, len);
    const cJSON* id = cJSON_GetObjectItemCaseSensitive(req, "id");
    const cJSON* args = cJSON_GetObjectItemCaseSensitive(req, "args");
    const char* error = nullptr;
    cJSON* result = nullptr;

    if (!cJSON_IsObject(req)) {
        error = "invalid_payload: not a JSON object";
    } else if (strcmp(name, "led.blink") == 0) {
        const cJSON* times = cJSON_GetObjectItemCaseSensitive(args, "times");
        double n = 3;  // the default this device declared in describe
        if (times && !cJSON_IsNull(times)) {
            if (!cJSON_IsNumber(times) || times->valuedouble != floor(times->valuedouble))
                error = "invalid_args: times: expected an integer";
            else if (times->valuedouble < 1) error = "invalid_args: times: below the minimum 1";
            else if (times->valuedouble > 20) error = "invalid_args: times: above the maximum 20";
            else n = times->valuedouble;
        }
        if (!error) {
            led_blink(static_cast<int>(n));
            result = cJSON_CreateObject();
            cJSON_AddNumberToObject(result, "times", n);
        }
    } else {
        error = "unknown_command";
    }

    cJSON* ack = cJSON_CreateObject();
    if (cJSON_IsString(id)) cJSON_AddStringToObject(ack, "id", id->valuestring);
    cJSON_AddStringToObject(ack, "cmd", name);
    cJSON_AddBoolToObject(ack, "ok", error == nullptr);
    if (result) cJSON_AddItemToObject(ack, "result", result);
    if (error) cJSON_AddStringToObject(ack, "error", error);
    char* out = cJSON_PrintUnformatted(ack);
    esp_mqtt_client_publish(c, cmd_ack_topic, out, 0, 1, 0);  // QoS 1, not retained
    cJSON_free(out);
    cJSON_Delete(ack);
    cJSON_Delete(req);
}
```

The config side follows the same pattern:

1. Parse `version` and `desired`. Ignore a message without both, which includes the empty payload of a cleared retained message.
2. For each of **your** keys, take the value from `desired`. Absent or `null` means the default. Check the value against the limits you declared. Keep the current value and record a reason for one that fails.
3. Write the values and the version to NVS, but only if they changed.
4. Publish `state`, retained, with the version, every key's value and the reasons.

Build the `describe` once at boot from the same table your config code uses, so the limits you publish and the limits you enforce cannot drift apart.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| The console shows the device as not described | No `describe` arrived, or it broke a rule and was refused as a whole. Check names against the pattern, `values` on every enum, a `default` inside its own limits, and no unknown fields. |
| A setting stays pending | The device has not published a `state` with the new version. Check that it subscribes to `devices/<id>/config` and publishes `state` after applying. |
| A setting shows as refused | The device's own check failed; `state.errors` has the reason. Usually the firmware's limits changed after the value was set. |
| Commands show "no answer" | No `cmd_ack` with that `id` within 60 seconds. Check that the ack copies `id` and goes to `cmd_ack`, not under `cmd/`. |
| A reading is missing from Readings | It was a string or an array, or its name broke the pattern. Only numbers and booleans become metrics. |
| The describe never reaches the broker | It is larger than the MQTT client's buffer. Raise the buffer above the size of your largest message. |

## FAQ

### What is a device shadow on an ESP32?

A device shadow is a pair of documents that hold an ESP32's settings: the desired values set from the cloud and the values the device reports it runs. On Paqett they are two retained MQTT messages, `config` from the platform and `state` from the device, so the ESP32 gets the latest desired values whenever it connects.

### How is this different from AWS IoT Device Shadow?

The desired and reported model is the same idea. The difference is that a Paqett device also publishes a typed description of its settings, commands and metrics, so the platform validates every value before it sends it and the console builds the controls with no per-device code.

### Where should an ESP32 store its configuration?

In NVS, the ESP-IDF key-value store in flash. The Paqett SDK keeps the whole configuration as one JSON blob in the `ipn_set` namespace and writes it only when it changes, which keeps flash wear low when the retained config arrives again on every connect.

### Do I have to use the Paqett SDK?

No. The protocol is JSON over MQTT, and any firmware that publishes `describe` and `state`, applies `config` and answers `cmd_ack` works. The SDK is one implementation; the esp-mqtt and cJSON example above is another.

### What happens if the desired config has a value my firmware rejects?

The device keeps its current value for that key, applies the others, and lists the key with a reason in `state.errors`. The console shows the setting as refused by the device, with that reason.

### How often should an ESP32 send telemetry?

As often as the readings change in a way that matters, and no more: every message is stored. Make the interval a setting, as the ESP32-C6's `telemetry.interval_s` is (5 to 3600 seconds, default 30), so it can be changed without new firmware.

## Sources

- [ESP-IDF: ESP-MQTT](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/protocols/mqtt.html): the MQTT client, its buffer size and its events.
- [ESP-IDF: Non-Volatile Storage Library](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/storage/nvs_flash.html): NVS namespaces and key-value storage.
- [cJSON](https://github.com/DaveGamble/cJSON): the JSON parser bundled with ESP-IDF.
- [MQTT Version 3.1.1 (OASIS Standard)](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html): retained messages and QoS 1.
- [AWS IoT Device Shadow service](https://docs.aws.amazon.com/iot/latest/developerguide/iot-device-shadows.html): the desired and reported model on AWS IoT Core, for comparison.
