---
title: "OTA updates: offers, downloads, status and rollback"
nav: "OTA updates"
description: "The OTA contract for Paqett IP devices: the retained MQTT offer, the signed HTTPS image URL, the device's rules, ota_status reports, jobs and releases."
tldr: "The platform publishes a retained QoS 1 offer on the device's ota topic with a job id, version, signed one-hour HTTPS URL, size and SHA-256. The device downloads into its spare slot, verifies size and digest, reboots on trial, confirms only after MQTT and hello, and reports each state on ota_status."
order: 5
updated: 2026-11-19
keywords: [ota firmware update protocol, ota over mqtt, firmware rollback, signed download url firmware, iot ota job states]
about: [ota, mqtt, esp32]
---

The platform offers a firmware image to one device over its MQTT session. The device downloads it over HTTPS, checks it, boots it on trial and reports how it went. The contract is the same for every chip: an ESP32 writes the image to its other app slot and uses the bootloader's rollback; a cellular modem would use its own download and DFU libraries. For the ESP32 code, see [ESP32 OTA updates over MQTT](/guides/esp32-ota-updates-over-mqtt).

## Releases

A release is a firmware image for one `model` (the device type a device enrolled with) and one `version` (the string its hello reports as `firmware`). One image per model and version, never replaced: a fixed build gets a new version. The platform computes the image's SHA-256 and size when it is uploaded, and those are what a device checks. Images are at most 4 MiB.

## The offer

The platform publishes the offer on `devices/<device id>/ota`, **retained, QoS 1**, so a device that is asleep or offline gets it when it next connects:

```json
{
  "job_id": "86b77f8c-...",
  "version": "0.2.1",
  "url": "https://api.paqett.com/v1/devices/firmware/75f8ee81-...?exp=1795000000&sig=...",
  "sha256": "f2066198...",
  "size": 1203456,
  "model": "esp32c6-devkit"
}
```

An empty retained payload clears the offer; the platform sends one when the job finishes or is cancelled. When a device whose job is still unfinished says hello, the platform re-sends the offer with a fresh URL: the old one may have expired while the device was away.

## The download

`url` is a signed HTTPS link on `api.paqett.com`, valid for one hour after the platform made it. It needs no API key, so a plain HTTP client can fetch it.

| Behaviour | Detail |
| --- | --- |
| Methods | `GET` and `HEAD` |
| Body | The image, `application/octet-stream`. `ETag` is its SHA-256. |
| Ranges | One `Range: bytes=a-b` (or `a-`, `-n`) is answered `206` with `Content-Range`, for resuming. A start past the end is `416`. |
| Errors | `403` for a bad or expired signature, `404` for an unknown release. |
| TLS | A public certificate, so a device verifies it with its usual public roots (the ESP-IDF certificate bundle, a modem's root store). |

The URL is a capability for one image, not a secret: an image can be read out of any device's flash anyway. What protects the device is the `sha256` in the offer, which arrives over its authenticated MQTT session. It boots nothing whose digest does not match.

## What the device does

1. **Another model.** `model` is not its own: it installs nothing and reports `failed` with `error: "model_mismatch"`.
2. **Already running it.** `version` is what it runs: it reports `succeeded`.
3. **Already done.** `job_id` is one it has finished: it reports that outcome again. A retained offer arrives on every connect until the platform clears it, so the device keeps its last job id and outcome across reboots.
4. **Download.** Otherwise it downloads `url` into its spare slot, reporting `downloading` with `progress` (0 to 100, at most every 10 %). A download that breaks is retried a few times before `failed` (`download_failed: ...`).
5. **Verify.** It reports `verifying`. `size` and `sha256` must match exactly, or it reports `failed` (`size_mismatch`, `sha256_mismatch`) and keeps the image it runs.
6. **Apply.** It marks the new image bootable, reports `applied`, and reboots into it.
7. **Trial.** The new image marks itself good only once its MQTT session is up and its hello is sent. If it crashes or resets before that, or does not get online within a timeout (10 minutes in the Paqett SDK), the device boots the previous image again.
8. **Rolled back.** Back on the previous image after `applied`, it reports `failed` with `error: "rolled_back"`.

## ota_status

The device reports on `devices/<device id>/ota_status`, QoS 1, not retained:

```json
{"job_id":"86b77f8c-...","state":"downloading","progress":40}
```

```json
{"job_id":"86b77f8c-...","state":"failed","error":"sha256_mismatch"}
```

`state` is one of `downloading`, `verifying`, `applied`, `succeeded`, `failed`. `error` is at most 200 characters.

## Jobs

A job is one update of one device. A device has at most one unfinished job.

| State | Set by |
| --- | --- |
| `offered` | The platform, when it publishes the offer |
| `downloading`, `verifying`, `applied` | The device's reports. A report never moves a job backwards. |
| `succeeded` | After `applied`, the device's next hello reports the release's version |
| `failed` | The device reports `failed`, or after `applied` its hello reports another version (it rolled back) |
| `cancelled` | Cancelled before `applied`. An applied image is already the boot image, so that job is judged by the next hello. |

The platform judges an update by what the device says when it comes back, not only by what it reported on the way: the hello after a reboot is the proof.

## Admin API

Releases and jobs are managed with an admin API key: `projects:read` to read, `devices:write` to change anything. Releases belong to a model, not a project: a model's image is the same for every fleet.

| Route | Scope | Does |
| --- | --- | --- |
| `GET /v1/admin/firmware?model=<model>` | `projects:read` | Releases, newest first |
| `POST /v1/admin/firmware?model=<model>&version=<version>` | `devices:write` | Upload a release. The body is the image, `application/octet-stream`. `201`; `409` if that model and version exist; `413` over 4 MiB. |
| `GET /v1/admin/projects/<project>/devices/<device id>/ota` | `projects:read` | The device's jobs, newest first |
| `POST /v1/admin/projects/<project>/devices/<device id>/ota` | `devices:write` | Start a job: `{"releaseId": "<release id>"}`. `409` when the release is for another model, the device is not an IP device, or it has an unfinished job. |
| `POST /v1/admin/projects/<project>/devices/<device id>/ota/<job id>/cancel` | `devices:write` | Cancel a job. `409` once it is finished or `applied`. |

```sh
# Upload a build as release 0.2.1 of model esp32c6-devkit
curl -sS -X POST -H "authorization: Bearer $PAQETT_ADMIN_KEY" \
  -H 'content-type: application/octet-stream' \
  --data-binary @.pio/build/esp32c6/firmware.bin \
  'https://api.paqett.com/v1/admin/firmware?model=esp32c6-devkit&version=0.2.1'

# Offer it to one device
curl -sS -X POST -H "authorization: Bearer $PAQETT_ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"releaseId":"<release id>"}' \
  https://api.paqett.com/v1/admin/projects/<project>/devices/<device id>/ota
```

## FAQ

### How long is the firmware download URL valid?

One hour. A device that reconnects with an unfinished job gets the offer again, with a fresh URL, when it says hello.

### Is the firmware image checked before it boots?

Yes. The device compares the downloaded image's size and SHA-256 with the offer, which arrives over its mutually authenticated MQTT session, and never makes an image bootable if either differs.

### What is the largest firmware image Paqett accepts?

A release can be up to 4 MiB. The device's own limit is the size of its spare OTA slot.

### How does Paqett know an update succeeded?

From the next hello. After the device reports applied, the platform marks the job succeeded when the device comes back reporting the release's version, and failed when it reports any other version, which means it rolled back.

### Can a firmware download be resumed?

Yes. The download URL answers a Range request with 206 Partial Content, so a client can resume. The Paqett ESP32 firmware restarts each attempt from the beginning instead.

## Sources

- [ESP-IDF: Over The Air Updates (OTA)](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html): app slots, otadata and bootloader rollback.
- [ESP-IDF: Partition Tables](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/partition-tables.html): the ota_0, ota_1 and otadata partitions an OTA layout needs.
- [ESP-IDF: ESP HTTP Client](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/protocols/esp_http_client.html): HTTPS downloads and the certificate bundle.
