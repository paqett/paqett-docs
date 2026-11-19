---
title: "How IP devices connect to Paqett"
nav: "Overview"
description: "How a device with its own IP connection enrols for an X.509 client certificate, talks MQTT over mutual TLS to Paqett and takes OTA firmware updates."
order: 1
updated: 2026-11-19
keywords: [iot device provisioning, x509 device certificate, mqtt mutual tls, device self provisioning, iot ota updates]
---

A device with its own IP connection (an ESP32 on WiFi today) does three things with Paqett: it **enrols itself** for an X.509 client certificate, it **talks MQTT over mutual TLS** with that certificate, and it **takes firmware updates** offered over the same MQTT session. This page is the map; the pages after it are the contract in detail.

## The flow

```text
device                                   api.paqett.com                  mqtt.paqett.com:8883
  | make an EC P-256 key + a CSR             |                                  |
  |-- POST /v1/devices/provision ----------->| project key, scope               |
  |   Bearer pq_live_..., hardware_id,       |   devices:provision              |
  |   model, firmware, csr_pem               | cert signed, CN = device id      |
  |<-- device_id, cert_pem, ca_pem, ... -----|                                  |
  |-- TLS: verify the broker with ca_pem, present cert_pem + own key ---------->|
  |-- devices/<id>/status (retained), devices/<id>/hello ---------------------->|
  |<-- devices/<id>/ota offer (retained) ---------------------------------------|
  |-- GET signed image URL (HTTPS) -->|                                         |
  |-- devices/<id>/ota_status ------------------------------------------------->|
```

1. **The device makes its own key.** An EC P-256 key pair, generated on the chip and kept there. It builds a certificate signing request (CSR) from it.
2. **It enrols.** `POST https://api.paqett.com/v1/devices/provision` with a project API key that carries the `devices:provision` scope. The answer is its certificate, the CA that signed it, and where to connect. See [Provisioning API](/devices/provisioning).
3. **It connects.** MQTT over TLS to `mqtt.paqett.com:8883`. The device verifies the broker against the CA it was given, and the broker verifies the device's certificate. The certificate's common name is the device id; the broker uses it as the MQTT username and client id, whatever the client sends.
4. **It talks under its own prefix.** Everything a device publishes or receives is under `devices/<device id>/`, and the broker lets it do nothing else. See [MQTT topics](/devices/mqtt-topics).
5. **It takes updates.** The platform offers a firmware image on `devices/<device id>/ota`; the device downloads it over HTTPS, checks its SHA-256, boots it on trial and confirms it only once it is back online. See [OTA updates](/devices/ota).

## Why the device makes its own key

The private key never leaves the device, and the platform stores no device secret. A leak of the platform's database, or of a provisioning response, exposes nothing that lets anyone connect as one of your devices.

There is also nothing per-device to flash at the factory. Every device in a fleet carries the same firmware and the same provisioning key; each one turns that into its own identity the first time it boots. The provisioning key can only enrol new devices into its project. Revoking it in the console stops enrolment; devices already enrolled keep working.

## What you need

- A Paqett project, and a project API key with only the `devices:provision` scope. It ships inside every device of the fleet, so give it nothing else.
- A device that can do TLS with ECDSA P-256 certificates and keep a few kilobytes in non-volatile storage. Any ESP32 on ESP-IDF 5 can.
- For OTA on an ESP32: a partition table with two app slots, and bootloader rollback turned on.

## Where to start

- Building on an ESP32: [ESP32 MQTT over mutual TLS with an X.509 client certificate](/guides/esp32-mqtt-mutual-tls-x509), then [ESP32 OTA updates over MQTT](/guides/esp32-ota-updates-over-mqtt).
- Porting to another chip: read the three reference pages. Nothing in the contract is specific to the ESP32.
