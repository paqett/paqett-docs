---
title: "ESP32 OTA updates over MQTT, with automatic rollback"
nav: "ESP32: OTA updates over MQTT"
description: "Update ESP32 firmware over MQTT with a signed HTTPS download into the spare OTA slot, a SHA-256 check, a trial boot and automatic rollback on failure."
section: guides
order: 2
updated: 2026-11-19
keywords: [esp32 ota update, esp32 ota over mqtt, esp32 ota rollback, esp_ota_mark_app_valid_cancel_rollback, esp32 ota partition table]
---

This guide shows how an ESP32 takes a firmware update offer over its MQTT session, downloads the image over HTTPS into its spare OTA slot, checks size and SHA-256, boots it on trial and keeps it only once it is back online. If the new image crashes or cannot reach the broker, the bootloader rolls back to the previous one and the device says so. It ends with publishing a release and rolling it out through the Paqett admin API.

The reference device is an ESP32-C6 on Arduino-ESP32 3.1.3 (ESP-IDF 5.3, via pioarduino). Everything on the device side is plain ESP-IDF API, so the same pattern works on any ESP32 running IDF 5.x, with or without Arduino.

**What you need**

- An ESP32 already connected to the Paqett broker with mutual TLS. If yours is not, start with [the mTLS guide](/guides/esp32-mqtt-mutual-tls-x509).
- A partition table with two OTA app slots (covered below).
- An admin API key with the `devices:write` scope, to upload releases and start updates.

## How it works

The update offer travels over MQTT, the image over HTTPS. The offer is small, authenticated by the device's TLS session and retained, so a device that is asleep or offline gets it when it next connects. The image is a plain HTTPS download from a short-lived signed URL.

```text
 Platform                         Broker                          ESP32
    |  offer (retained, QoS 1)      |                               |
    |------------------------------>|  devices/<id>/ota             |
    |                               |------------------------------>|
    |                               |                               |  model ok? new version?
    |                               |   GET signed URL (HTTPS)      |
    |<--------------------------------------------------------------|
    |   image bytes                                                 |  write to spare slot,
    |-------------------------------------------------------------->|  hash as it goes
    |                               |  ota_status: downloading 0..100
    |<------------------------------|<------------------------------|
    |                               |  ota_status: verifying        |  size + sha256 match?
    |<------------------------------|<------------------------------|
    |                               |  ota_status: applied          |  set boot partition
    |<------------------------------|<------------------------------|
    |                               |                               |  reboot -> trial boot
    |                               |  status, hello (new firmware) |
    |<------------------------------|<------------------------------|  confirm image
    |                               |  ota_status: succeeded        |
    |<------------------------------|<------------------------------|
    |  empty retained payload       |                               |
    |------------------------------>|  (offer cleared)              |
```

If the trial image never gets as far as the hello, the bootloader boots the old slot, and the old image reports `failed` with `error: "rolled_back"`.

## The OTA partition table

An ESP32 OTA update needs two app slots, `ota_0` and `ota_1`, plus an `otadata` partition that records which one to boot. The running image is never written. The update goes into the other slot, and only a completed, verified image is ever made bootable.

Slot size is the constraint that bites first. An Arduino image with Wi-Fi, TLS and MQTT is already around 1.2 MB. The default Arduino table (`default.csv`) gives each slot 0x140000 bytes, 1.25 MB, which leaves almost no headroom. On a 4 MB flash, `min_spiffs.csv` trades SPIFFS space for two 1.9 MB slots:

```csv
# Name,   Type, SubType, Offset,  Size, Flags
nvs,      data, nvs,     0x9000,  0x5000,
otadata,  data, ota,     0xe000,  0x2000,
app0,     app,  ota_0,   0x10000, 0x1E0000,
app1,     app,  ota_1,   0x1F0000,0x1E0000,
spiffs,   data, spiffs,  0x3D0000,0x20000,
coredump, data, coredump,0x3F0000,0x10000,
```

In PlatformIO:

```ini
[env:esp32c6]
board = esp32-c6-devkitc-1
framework = arduino
board_upload.flash_size = 4MB
board_build.partitions = min_spiffs.csv
```

Changing the partition table needs a serial flash. An OTA update cannot change it, so pick the layout before devices leave the bench.

### Enabling bootloader rollback

Rollback is the bootloader's job. With `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` set, a freshly installed image boots in the `ESP_OTA_IMG_PENDING_VERIFY` state. If the device resets before the application calls `esp_ota_mark_app_valid_cancel_rollback()`, the bootloader treats the image as failed and boots the previous slot.

On pure ESP-IDF, turn it on in menuconfig. Arduino-ESP32 3.1.3's prebuilt bootloader and libraries already have it enabled. There is a catch: at start-up the Arduino core checks for a pending image and confirms it immediately, before your code has proved anything. It skips that only when a weak hook, `verifyRollbackLater()`, returns true. Override it:

```cpp
// Arduino-ESP32 confirms a pending OTA image at startup unless this returns
// true. We confirm it ourselves, once MQTT is up and the hello is sent.
extern "C" bool verifyRollbackLater() { return true; }
```

Without this override every image is marked valid at boot, and rollback only ever catches a crash before `setup()` runs.

## Handling the offer

The platform publishes the offer retained, QoS 1, on `devices/<id>/ota`:

```json
{"job_id":"8b1e...","version":"0.2.1","url":"https://api.paqett.com/v1/devices/firmware/4c0f...?exp=1795000000&sig=...","sha256":"9f86...","size":1234567,"model":"esp32c6-devkit"}
```

An empty retained payload means there is no offer: the platform sends one when the job finishes or is cancelled. Subscribe to the topic at QoS 1 on every connect.

Because the offer is retained, it arrives again on every connect until the platform clears it. The device must recognise a job it has already dealt with. It applies these rules:

1. `model` is not its own: install nothing, report `failed` with `error: "model_mismatch"`.
2. `version` equals the firmware it runs: report `succeeded`.
3. `job_id` is the last job it finished: repeat that outcome.
4. `size` is larger than the spare slot: report `failed` with `too_large`.
5. Otherwise, download.

An empty payload while a download is running stops it. A second offer for the job already in progress is not a new job; if the device is waiting to retry, it picks up the new URL from it.

```cpp
void on_ota_message(const Offer& offer) {
    if (offer.job_id == last.job_id && last.phase != Phase::None) {
        // The retained offer again: repeat what we said last time.
        if (last.phase == Phase::Succeeded) report(offer.job_id, "succeeded", 100, "");
        else if (last.phase == Phase::Failed) report(offer.job_id, "failed", -1, last.error);
        return;
    }
    if (offer.model != MY_MODEL)          return finish_failed(offer, "model_mismatch");
    if (offer.version == MY_FIRMWARE)     return finish_succeeded(offer);

    const esp_partition_t* spare = esp_ota_get_next_update_partition(nullptr);
    if (!spare)                           return finish_failed(offer, "no spare OTA slot");
    if (offer.size > spare->size)         return finish_failed(offer, "too_large");

    start_download(offer, spare);          // on its own task; see below
}
```

`report()` publishes to `devices/<id>/ota_status`, QoS 1, not retained:

```json
{"job_id":"8b1e...","state":"downloading","progress":40}
{"job_id":"8b1e...","state":"failed","error":"sha256_mismatch"}
```

`state` is one of `downloading`, `verifying`, `applied`, `succeeded` or `failed`. Keep `error` to 200 characters. If the device is offline when it reports `applied`, `succeeded` or `failed`, hold the report and send it on the next connect; a stale progress figure is not worth keeping.

### Remember the last job across reboots

Rule 3 only works if the device remembers its last job through a reboot, and the reboot into the new image is the reboot that matters most. Keep the job id, the version it installs, a phase (none, applied, succeeded, failed) and the error in NVS. Write the phase last: a power cut part-way through leaves the old phase against the new job id at worst, which only repeats a report.

```cpp
#include <Preferences.h>

bool save_record(const Record& r) {
    Preferences p;
    if (!p.begin("ipn_ota", false)) return false;
    bool ok = p.putString("job", r.job_id.c_str()) && p.putString("ver", r.version.c_str()) &&
              p.putString("err", r.error.c_str()) &&
              p.putString("phase", String(static_cast<int>(r.phase)));  // last
    p.end();
    return ok;
}
```

## Downloading into the spare slot

The `url` in the offer is a signed HTTPS link on api.paqett.com. It is valid for one hour, needs no API key and serves the image as `application/octet-stream`. The server uses a public Let's Encrypt certificate, so `esp_crt_bundle_attach` (the IDF certificate bundle) verifies it; you do not ship a pinned CA for downloads.

Run the download on its own FreeRTOS task so the MQTT loop keeps going. Hash the bytes with mbedTLS as they stream into flash:

```cpp
#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_ota_ops.h>
#include <mbedtls/sha256.h>

// Runs on the download task. On success, leaves `h` open for verification.
bool download(const char* url, const esp_partition_t* target, esp_ota_handle_t& h,
              uint32_t& total, unsigned char digest[32], std::string& error) {
    esp_http_client_config_t cfg = {};
    cfg.url = url;
    cfg.timeout_ms = 15000;
    cfg.disable_auto_redirect = true;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) { error = "http client init failed"; return false; }

    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    mbedtls_sha256_starts(&sha, 0);  // 0 = SHA-256, not SHA-224
    static char buf[4096];
    bool began = false, ok = false;
    total = 0;

    do {
        if (esp_http_client_open(c, 0) != ESP_OK) { error = "connect"; break; }
        int64_t length = esp_http_client_fetch_headers(c);
        int status = esp_http_client_get_status_code(c);
        if (status != 200) { error = "http " + std::to_string(status); break; }
        if (length > (int64_t)target->size) { error = "image larger than the slot"; break; }

        // Erase as we go rather than trusting the offer's size for the erase.
        if (esp_ota_begin(target, OTA_WITH_SEQUENTIAL_WRITES, &h) != ESP_OK) { error = "ota begin"; break; }
        began = true;

        for (;;) {
            int n = esp_http_client_read(c, buf, sizeof buf);
            if (n < 0) { error = "read error"; break; }
            if (n == 0) {
                if (!esp_http_client_is_complete_data_received(c)) error = "connection closed early";
                break;
            }
            if (total + n > target->size) { error = "image larger than the slot"; break; }
            mbedtls_sha256_update(&sha, (const unsigned char*)buf, n);
            if (esp_ota_write(h, buf, n) != ESP_OK) { error = "ota write"; break; }
            total += n;
            // queue a progress event for the MQTT task here
        }
        if (!error.empty()) break;
        mbedtls_sha256_finish(&sha, digest);
        ok = true;
    } while (false);

    mbedtls_sha256_free(&sha);
    esp_http_client_close(c);
    esp_http_client_cleanup(c);
    if (began && !ok) esp_ota_abort(h);
    return ok;
}
```

Report `downloading` with `progress` from 0 to 100, at most every 10 %. Do the MQTT publish on the task that owns the client, not from the download task: queue the byte count and let the main loop turn it into a percentage of the offer's `size`.

A download that breaks is retried before the job fails. The reference firmware makes three attempts, waiting 30 seconds times the attempt number between them, then reports `failed` with `download_failed: ` followed by the last error. Each attempt starts from byte zero.

## Verifying SHA-256 and size, then applying

When the transfer completes, report `verifying` and compare against the offer. Both must match exactly:

```cpp
std::string hex(const unsigned char d[32]) {
    static const char x[] = "0123456789abcdef";
    std::string s;
    for (int i = 0; i < 32; ++i) { s += x[d[i] >> 4]; s += x[d[i] & 0x0F]; }
    return s;
}

report(job, "verifying", -1, "");
if (total != offer.size)              { esp_ota_abort(h); return finish_failed(offer, "size_mismatch"); }
if (hex(digest) != offer.sha256)      { esp_ota_abort(h); return finish_failed(offer, "sha256_mismatch"); }

esp_err_t err = esp_ota_end(h);       // IDF's own checks: header, segments, appended hash
if (err != ESP_OK)                    return finish_failed(offer, "activate_failed: image invalid");
err = esp_ota_set_boot_partition(target);
if (err != ESP_OK)                    return finish_failed(offer, "activate_failed: set boot partition");

save_record({offer.job_id, offer.version, Phase::Applied, ""});
report(offer.job_id, "applied", -1, "");
// give `applied` ~2 s to leave, then:
esp_restart();
```

The offer's `sha256` is lower-case hex. The platform computes it, and `size`, when the release is uploaded.

The SHA-256 is what protects the device. The download URL is a capability for one image, not a secret, and an image can be read out of any device's flash anyway. The digest arrives over the device's authenticated MQTT session, and the device boots nothing whose digest does not match.

On any failure before `esp_ota_set_boot_partition`, the running image is untouched and remains the boot image.

## Confirming the new image, or rolling back

After the reboot, the new image is on trial. At boot, check whether the running slot is pending verification:

```cpp
static bool on_trial = false;
static uint64_t confirm_deadline_ms = 0;
constexpr uint64_t CONFIRM_TIMEOUT_MS = 10 * 60 * 1000;

void ota_begin(uint64_t now_ms) {
    esp_ota_img_states_t st;
    on_trial = esp_ota_get_state_partition(esp_ota_get_running_partition(), &st) == ESP_OK &&
               st == ESP_OTA_IMG_PENDING_VERIFY;
    confirm_deadline_ms = now_ms + CONFIRM_TIMEOUT_MS;
}
```

Confirm only when the image has proved the thing that matters: it reached the broker with its identity and said which firmware it runs. In the reference firmware that is the moment the MQTT session is up and the hello has been published, so the confirm call sits right after the hello:

```cpp
void on_mqtt_connected() {
    publish_status_online();
    subscribe_cmd_and_ota();
    bool hello_sent = publish_hello();   // includes "firmware"
    if (!hello_sent) return;

    if (on_trial && esp_ota_mark_app_valid_cancel_rollback() == ESP_OK) on_trial = false;

    if (last.phase == Phase::Applied) {
        if (last.version == MY_FIRMWARE && !on_trial) finish_succeeded(last);
        else if (last.version != MY_FIRMWARE)         finish_failed(last, "rolled_back");
    }
}
```

The second half is how a rolled-back device reports it. The record still says `applied` for version 0.2.1, but the image that came online reports 0.2.0: the bootloader went back, so the job is `failed` with `rolled_back`.

Two things trigger a rollback:

- **Any reset before confirmation.** A crash, a watchdog or a brown-out during the trial boot leaves the slot in `ESP_OTA_IMG_PENDING_VERIFY`, and the bootloader boots the previous slot instead.
- **No confirmation within the timeout.** An image that runs but cannot get online would never reset by itself. Check the deadline in the main loop and give up explicitly:

```cpp
void ota_tick(uint64_t now_ms) {
    if (on_trial && now_ms >= confirm_deadline_ms) {
        on_trial = false;
        // Marks this slot invalid and reboots into the previous one.
        // Returns only if there is no previous image to go back to.
        esp_ota_mark_app_invalid_rollback_and_reboot();
        esp_restart();
    }
}
```

The reference firmware uses ten minutes (`IPNODE_OTA_CONFIRM_TIMEOUT_MS`), counted from boot. Long enough to ride out a slow Wi-Fi join and a broker reconnect, short enough that a broken image is not left running all afternoon.

The platform does not rely on the device's report alone. After `applied`, it judges the job by the device's next hello: the new version means `succeeded`, any other version means `failed`. A device that rolls back and stays quiet is still caught.

For scale: an ESP32-C6 update from 0.2.0 to 0.2.1 over Wi-Fi, offer to confirmed, took about 31 seconds.

## Publishing a release and rolling it out

A release is a `(model, version)` pair plus its image. `model` is the device's type, the `model` it provisioned with. `version` must be exactly the string the new image reports as `firmware` in its hello. Releases are immutable: a fixed build gets a new version. An image can be at most 4 MiB.

Upload the build output with an admin API key that has the `devices:write` scope:

```sh
curl -sS -X POST \
  -H "authorization: Bearer $PAQETT_ADMIN_KEY" \
  -H 'content-type: application/octet-stream' \
  --data-binary @.pio/build/esp32c6/firmware.bin \
  'https://api.paqett.com/v1/admin/firmware?model=esp32c6-devkit&version=0.2.1'
```

The response is `201` with the release, including its `id`, `sha256` and `size`. A second upload of the same model and version is `409`; over 4 MiB is `413`. `model` and `version` can also go in `X-Firmware-Model` and `X-Firmware-Version` headers. `GET /v1/admin/firmware?model=esp32c6-devkit` lists releases, newest first (that needs `projects:read`).

Start an update for one device:

```sh
curl -sS -X POST \
  -H "authorization: Bearer $PAQETT_ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"releaseId":"<release id>"}' \
  'https://api.paqett.com/v1/admin/projects/<project>/devices/<device id>/ota'
```

This returns `201` with the job and publishes the offer. It is `409` if the release is for another model, the device holds no device certificate, or it already has an unfinished job: a device has at most one at a time.

Follow progress with `GET /v1/admin/projects/<project>/devices/<device id>/ota`, which lists the device's jobs, newest first.

### Job states

| State | Meaning |
| --- | --- |
| `offered` | Job created, offer published |
| `downloading` | The device reported download progress |
| `verifying` | The device is checking size and SHA-256 |
| `applied` | The new image is the boot image; the device is rebooting into it |
| `succeeded` | After `applied`, the next hello reported the release's version |
| `failed` | The device reported `failed`, or came back on another version after `applied` |
| `cancelled` | Cancelled before `applied` |

A report never moves a job backwards. A hello with the release's version also finishes a job that never reached `applied`: the device runs that version already. If a device reconnects while its job is still `offered`, `downloading` or `verifying`, its hello makes the platform re-send the offer with a fresh URL, since the old one may have expired while it was away. Jobs do not time out on their own.

### Cancelling

```sh
curl -sS -X POST -H "authorization: Bearer $PAQETT_ADMIN_KEY" \
  'https://api.paqett.com/v1/admin/projects/<project>/devices/<device id>/ota/<job id>/cancel'
```

The platform clears the retained offer, and a device that is mid-download stops. Cancelling a job that is finished or already `applied` is `409`: an applied image is already the boot image, and the next hello decides the job.

## Troubleshooting

**`sha256_mismatch`.** The bytes the device received are not the bytes the platform hashed at upload. The digest is computed from the uploaded file itself, so uploading the wrong file does not cause this one; look at what sits between the device and api.paqett.com, then start a new job. The running image is untouched.

**`size_mismatch`.** The transfer completed with a different byte count from the offer's `size`. Same checks as for `sha256_mismatch`. The running image is untouched.

**`too_large` or `image larger than the slot`.** The image does not fit the spare slot. Move to a table with bigger app slots, such as `min_spiffs.csv`, which means a serial flash. Check this before you need it: build size grows quietly.

**`download_failed: http 403`.** The signed URL expired or was altered. URLs last an hour. A device that reconnects after a long sleep may first try the stale retained offer; its hello brings a fresh URL, and a pending retry picks it up. If the job has already failed, start a new job.

**`activate_failed: image invalid`.** `esp_ota_end` rejected the image. It was built for another chip, or it is not an app image at all: upload `firmware.bin`, not the `.elf` or a merged image that includes the bootloader.

**The image boots, then rolls back.** Either it reset before confirming, or it did not reach MQTT and send its hello within ten minutes. Read the old image's log for the reset reason and the new image's for its Wi-Fi and TLS errors. A new build that changes the broker settings, certificate storage or NVS layout is the usual suspect. To test the rollback path itself, the reference firmware has a bench-only flag, `IPNODE_TEST_NEVER_ONLINE`, that builds an image which never joins Wi-Fi. Never ship it.

**`rolled_back`, but the new code is running.** The `version` you uploaded does not match the `firmware` string the build reports. The device confirms the image, then sees a version that is not the job's. Make the release version and the version compiled into the image the same string.

**`succeeded` instantly, nothing installed.** The build reports the version the device already runs. Bump the version in the build, upload it as a new release, and start a new job.

**The serial monitor reset the device.** Opening the USB serial port resets an ESP32-C6 with native USB. Mid-download, that throws the download away; during the trial boot, it rolls the update back. Do not attach a monitor in the middle of an update. Open it first and leave it open.

## FAQ

### Does ESP32 OTA need two partitions?

Yes, for an update that can fail safely. The image is written to the slot that is not running, and the bootloader switches only after the image is complete and verified. That also gives the bootloader a known-good image to roll back to.

### What happens if power fails during an OTA update?

During the download, nothing changes: the boot partition still points at the running image. After power returns, the device reconnects, its hello brings the offer back with a fresh URL, and the download starts again from the beginning. During the trial boot, a power cut is a reset before confirmation, so the bootloader boots the previous image and the device reports `rolled_back`.

### When should I call esp_ota_mark_app_valid_cancel_rollback?

After the new image has proved what you care about, not at the top of `app_main` or `setup()`. For a connected device that means: the network is up, the MQTT session is authenticated, and the device has reported its firmware version. Pair it with a timeout that calls `esp_ota_mark_app_invalid_rollback_and_reboot()`, or an image that hangs offline stays on trial for ever.

### Is the image signed?

The image is not signed separately. The device trusts the SHA-256 in the offer, which comes over its mutual-TLS MQTT session, and checks every byte it downloads against it. The HTTPS download is verified with public roots, and an image whose digest does not match is never made bootable.

### Can I downgrade a device?

Yes. The device compares versions for equality only, so an older release is just another job. Upload it if it is not already there and start a job with its release id.

## Next

- [OTA reference](/devices/ota): the full contract, including every field and error.
- [MQTT topics](/devices/mqtt-topics): everything a device publishes and receives.
- [ESP32 MQTT with mutual TLS](/guides/esp32-mqtt-mutual-tls-x509): provisioning the device certificate this guide builds on.
