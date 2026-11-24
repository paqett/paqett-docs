---
title: "How IP devices connect to Paqett"
nav: "Overview"
description: "How an IP device enrols for an X.509 client certificate, talks MQTT over mutual TLS to Paqett, describes its own settings and commands, and takes OTA updates."
tldr: "A Paqett IP device generates its own EC P-256 key, enrols for an X.509 client certificate with POST /v1/devices/provision, connects to mqtt.paqett.com:8883 over mutual TLS and publishes under its own devices/ prefix. It describes its own metrics, settings and commands, takes desired config and commands, and takes OTA firmware updates over the same MQTT session."
order: 1
updated: 2026-11-24
keywords: [iot device provisioning, x509 device certificate, mqtt mutual tls, device self provisioning, iot ota updates, iot device shadow]
about: [x509, mqtt, mtls, ota, csr, pki, digital-twin]
---

A device with its own IP connection (an ESP32 on Wi-Fi today) does four things with Paqett: it **enrols itself** for an X.509 client certificate, it **talks MQTT over mutual TLS** with that certificate, it **describes itself** so the platform can show its readings and change its settings, and it **takes firmware updates** offered over the same MQTT session. This page is the map; the pages after it are the contract in detail.

## The flow

```text
device                                   api.paqett.com                  mqtt.paqett.com:8883
  | make an EC P-256 key + a CSR             |                                  |
  |-- POST /v1/devices/provision ----------->| project key, scope               |
  |   Bearer pq_live_..., hardware_id,       |   devices:provision              |
  |   model, firmware, csr_pem               | cert signed, CN = device id      |
  |<-- device_id, cert_pem, ca_pem, ... -----|                                  |
  |-- TLS: verify the broker with ca_pem, present cert_pem + own key ---------->|
  |-- devices/<id>/status, describe (retained), hello, state (retained) ------->|
  |-- devices/<id>/telemetry -------------------------------------------------->|
  |<-- devices/<id>/config (retained), cmd/<name> ------------------------------|
  |-- devices/<id>/cmd_ack ---------------------------------------------------->|
  |<-- devices/<id>/ota offer (retained) ---------------------------------------|
  |-- GET signed image URL (HTTPS) -->|                                         |
  |-- devices/<id>/ota_status ------------------------------------------------->|
```

1. **The device makes its own key.** An EC P-256 key pair, generated on the chip and kept there. It builds a certificate signing request (CSR) from it.
2. **It enrols.** `POST https://api.paqett.com/v1/devices/provision` with a project API key that carries the `devices:provision` scope. The answer is its certificate, the CA that signed it, and where to connect. See [Provisioning API](/devices/provisioning).
3. **It connects.** MQTT over TLS to `mqtt.paqett.com:8883`. The device verifies the broker against the CA it was given, and the broker verifies the device's certificate. The certificate's common name is the device id; the broker uses it as the MQTT username and client id, whatever the client sends.
4. **It talks under its own prefix.** Everything a device publishes or receives is under `devices/<device id>/`, and the broker lets it do nothing else. See [MQTT topics](/devices/mqtt-topics).
5. **It describes itself.** On every connect the device publishes a retained `describe`: its metrics, its settings as typed fields with limits, and its commands. It sends readings on `telemetry`, reports the settings it runs on `state`, applies the desired settings it receives on `config`, and answers commands on `cmd_ack`. Nothing about a particular device is written into the platform. See [Control protocol](/devices/control-protocol).
6. **It takes updates.** The platform offers a firmware image on `devices/<device id>/ota`; the device downloads it over HTTPS, checks its SHA-256, boots it on trial and confirms it only once it is back online. See [OTA updates](/devices/ota).

## Why the device makes its own key

The private key never leaves the device, and the platform stores no device secret. A leak of the platform's database, or of a provisioning response, exposes nothing that lets anyone connect as one of your devices.

There is also nothing per-device to flash at the factory. Every device in a fleet carries the same firmware and the same provisioning key; each one turns that into its own identity the first time it boots. The provisioning key can only enrol new devices into its project. Revoking it in the console stops enrolment; devices already enrolled keep working.

## What you need

- A Paqett project, and a project API key with only the `devices:provision` scope. It ships inside every device of the fleet, so give it nothing else.
- A device that can do TLS with ECDSA P-256 certificates and keep a few kilobytes in non-volatile storage. Any ESP32 on ESP-IDF 5 can.
- For OTA on an ESP32: a partition table with two app slots, and bootloader rollback turned on.

## Where to start

- Building on an ESP32: [ESP32 MQTT over mutual TLS with an X.509 client certificate](/guides/esp32-mqtt-mutual-tls-x509), then [ESP32 device shadow over MQTT](/guides/esp32-device-shadow-config-commands) and [ESP32 OTA updates over MQTT](/guides/esp32-ota-updates-over-mqtt).
- Porting to another chip: read the reference pages, [Provisioning API](/devices/provisioning), [MQTT topics](/devices/mqtt-topics), [Control protocol](/devices/control-protocol) and [OTA updates](/devices/ota). Nothing in the contract is specific to the ESP32.

## FAQ

### What is device self-provisioning?

Device self-provisioning means a device obtains its own identity the first time it boots, instead of having one loaded at the factory. On Paqett, the device generates an EC P-256 key, sends a certificate signing request with the fleet's provisioning key, and receives an X.509 certificate whose common name is its device id.

### Does Paqett store device private keys?

No. The private key is generated on the device and never leaves it. The platform keeps only the certificates it issued and the fingerprints of their public keys, so a database leak gives nobody a way to connect as one of your devices.

### What happens if someone extracts the provisioning key from a device?

They can enrol new devices into that one project, nothing more. They cannot take over an existing device, because re-provisioning is pinned to each device's original key, and they cannot reach any other project. Rotating the provisioning key in the console stops further enrolment; devices already enrolled keep working.

### How does the platform know what settings a device has?

The device tells it. On every connect it publishes a retained `describe` message listing its metrics, its config keys with a type and limits for each, and its commands with their arguments. The platform validates config and commands against that description, and the console builds the device's screens from it.

### Which chips can connect to Paqett this way?

Any device that can generate an EC P-256 key, build a PKCS#10 certificate signing request and speak MQTT over TLS can use the contract. The guides use an ESP32-C6 on ESP-IDF 5.3 through Arduino-ESP32 3.1.3; nothing in the protocol is specific to the ESP32.

## Sources

- [RFC 5280: Internet X.509 Public Key Infrastructure Certificate and CRL Profile](https://www.rfc-editor.org/rfc/rfc5280): the X.509 certificate format the device and broker certificates follow.
- [RFC 2986: PKCS #10 Certification Request Syntax](https://www.rfc-editor.org/rfc/rfc2986): the CSR format a device sends to enrol.
- [MQTT Version 3.1.1 (OASIS Standard)](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html): retained messages, last will, QoS 1 and topic filters.
- [ESP-IDF: Over The Air Updates (OTA)](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html): app slots, otadata and bootloader rollback.
