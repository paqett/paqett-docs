---
title: "ESP32 MQTT over mutual TLS with an X.509 client certificate"
nav: "ESP32: MQTT over mutual TLS"
description: "Give an ESP32 its own P-256 key, build a CSR with mbedTLS, enrol for an X.509 client certificate and connect esp-mqtt to MQTT over mutual TLS."
section: guides
order: 1
updated: 2026-11-19
keywords: [esp32 mqtt tls, esp32 mutual tls, esp32 x509 client certificate, esp-mqtt client certificate, mbedtls csr esp32]
---

By the end of this guide your ESP32 makes its own EC P-256 key, sends a certificate signing request to the Paqett platform and gets back an X.509 client certificate. It then connects to the Paqett MQTT broker over mutual TLS with esp-mqtt, announces itself and listens for commands. No password or shared secret ever reaches the device.

The code comes from the Paqett SDK's ESP32-C6 adapter (Arduino-ESP32 3.1.3 on ESP-IDF 5.3, built with pioarduino). It calls ESP-IDF, mbedTLS and esp-mqtt directly, so it carries over to any ESP32 on IDF 5.x.

## What you need

- An ESP32 with Wi-Fi up. The examples use an ESP32-C6.
- ESP-IDF 5.x, directly or through Arduino-ESP32 3.x.
- A Paqett project and access to the Paqett console.
- A provisioning API key for that project (step 1).

## How mutual TLS works on an ESP32

Ordinary TLS proves one thing: the server is who it claims to be. Mutual TLS adds the other direction. During the handshake the device presents its own X.509 certificate and proves it holds the matching private key. The broker checks that certificate against its CA and takes the device's identity from it.

On Paqett the certificate's CN is the device id. The broker sets the MQTT username and client id from that CN, whatever the client sends, and only lets the device use topics under `devices/<id>/`.

The device makes its own key and never sends it anywhere. The platform signs a CSR, which carries only the public key. So the platform stores no device secret: a leak of its database, or of a provisioning response, gives nobody a way to connect as your device.

```text
ESP32                                 api.paqett.com                  mqtt.paqett.com:8883
  | make EC P-256 key + CSR                 |                                  |
  |-- POST /v1/devices/provision ---------->| key needs devices:provision      |
  |   Bearer pq_live_...                    | CSR checked, cert CN = device id |
  |   {hardware_id, model, firmware,        |                                  |
  |    csr_pem}                             |                                  |
  |<-- {device_id, cert_pem, ca_pem, -------|                                  |
  |     mqtt_host, mqtt_port,               |                                  |
  |     topic_prefix, cert_not_after}       |                                  |
  |                                                                            |
  |-- TLS: verify broker with ca_pem, present cert_pem + own key ------------->|
  |                                              CN -> username + client id    |
  |-- PUBLISH devices/<id>/status {"online":true} (retained) ----------------->|
  |-- PUBLISH devices/<id>/hello ---------------------------------------------->|
  |-- SUBSCRIBE devices/<id>/cmd/#, devices/<id>/ota ------------------------->|
```

## Step 1: Create a provisioning key

In the Paqett console, create a project API key with the `devices:provision` scope and nothing else. It looks like `pq_live_...`.

This key ships in every device of the fleet, and anyone can read it out of one device's flash. That is why it should carry only this scope. It can enrol new devices into its project and do nothing else. Revoking it in the console stops enrolment. Devices that already have a certificate keep working.

## Step 2: Generate an EC P-256 key on the ESP32

First, a stable identity for the chip. The platform expects `hardware_id` to match `^[a-z0-9][a-z0-9-]{2,63}$`, and for an ESP32-C6 the convention is `esp32c6-` followed by the base MAC in lower-case hex.

```cpp
#include <esp_mac.h>
#include <cstdio>
#include <string>

std::string make_hardware_id() {
    // ESP_MAC_BASE is the 6-byte factory MAC from eFuse. Don't use
    // esp_efuse_mac_get_default() on the C6: it writes the 8-byte EUI-64.
    uint8_t mac[8] = {};
    esp_read_mac(mac, ESP_MAC_BASE);
    char id[32];
    std::snprintf(id, sizeof id, "esp32c6-%02x%02x%02x%02x%02x%02x",
                  mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return id;
}
```

Start the Wi-Fi radio before you generate the key. mbedTLS draws from the ESP32's hardware RNG, which only produces true entropy while the RF subsystem is running. The SDK calls `WiFi.mode(WIFI_STA)` at boot, before anything touches the key.

## Step 3: Generate a CSR on the ESP32 with mbedTLS

The key and the CSR come from one function. The CSR must be PKCS#10 for an EC P-256 key, signed with ECDSA-SHA256, and at most 4 KiB. The platform ignores its subject, so the SDK simply puts the hardware id in the CN.

```cpp
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/ecp.h>
#include <mbedtls/entropy.h>
#include <mbedtls/pk.h>
#include <mbedtls/x509_csr.h>
#include <cstring>
#include <string>

bool make_key_and_csr(const std::string& cn, std::string& key_pem, std::string& csr_pem) {
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    mbedtls_pk_context pk;
    mbedtls_x509write_csr req;
    mbedtls_entropy_init(&entropy);
    mbedtls_ctr_drbg_init(&drbg);
    mbedtls_pk_init(&pk);
    mbedtls_x509write_csr_init(&req);

    static const char pers[] = "device-identity";
    unsigned char buf[1024];
    const std::string subject = "CN=" + cn;

    bool ok =
        mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &entropy,
                              reinterpret_cast<const unsigned char*>(pers), sizeof pers - 1) == 0 &&
        mbedtls_pk_setup(&pk, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY)) == 0 &&
        mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(pk),
                            mbedtls_ctr_drbg_random, &drbg) == 0 &&
        mbedtls_pk_write_key_pem(&pk, buf, sizeof buf) == 0;
    if (ok) key_pem.assign(reinterpret_cast<const char*>(buf));

    if (ok) {
        mbedtls_x509write_csr_set_md_alg(&req, MBEDTLS_MD_SHA256);
        mbedtls_x509write_csr_set_key(&req, &pk);
        ok = mbedtls_x509write_csr_set_subject_name(&req, subject.c_str()) == 0 &&
             mbedtls_x509write_csr_pem(&req, buf, sizeof buf, mbedtls_ctr_drbg_random, &drbg) == 0;
    }
    if (ok) csr_pem.assign(reinterpret_cast<const char*>(buf));

    std::memset(buf, 0, sizeof buf);  // the key passed through this buffer
    mbedtls_x509write_csr_free(&req);
    mbedtls_pk_free(&pk);
    mbedtls_ctr_drbg_free(&drbg);
    mbedtls_entropy_free(&entropy);
    return ok;
}
```

### Store the private key in NVS

The SDK keeps the key and the CSR as PEM strings in their own NVS namespace, `ipn_id`, so they can be wiped separately from everything else. On Arduino-ESP32 the `Preferences` class is a thin wrapper over NVS:

```cpp
#include <Preferences.h>

bool nvs_put(const char* ns, const char* key, const std::string& value) {
    Preferences p;
    if (!p.begin(ns, false)) return false;
    const size_t n = p.putString(key, value.c_str());
    p.end();
    return n == value.size();
}

// Drop any old CSR first, so a new key never pairs with a stale CSR.
// nvs_remove("ipn_id", "csr_pem");
// nvs_put("ipn_id", "key_pem", key_pem) && nvs_put("ipn_id", "csr_pem", csr_pem);
```

Store the CSR alongside the key. Re-provisioning then sends exactly the same CSR, and if a power cut leaves a key without a CSR, the SDK parses the stored key with `mbedtls_pk_parse_key` and rebuilds the CSR from it.

Treat the key PEM as radioactive. Hand it only to the TLS stack, never print it, and zero any buffer it passed through. For production, turn on NVS encryption and flash encryption so the key isn't readable from a dumped flash image.

## Step 4: Enrol with POST /v1/devices/provision

The request is a JSON POST with the provisioning key as a bearer token. PEM contains newlines, so escape them as `\n` when you build the body.

```json
{
  "hardware_id": "esp32c6-40ac1b2c3d4e",
  "model": "esp32c6-devkit",
  "firmware": "0.3.0",
  "csr_pem": "-----BEGIN CERTIFICATE REQUEST-----\nMIIB...\n-----END CERTIFICATE REQUEST-----\n"
}
```

`model` is 1 to 64 characters and becomes the device type of a new device. `firmware` is 1 to 32 characters.

The SDK sends it with `esp_http_client`. api.paqett.com has a public certificate, so the ESP-IDF certificate bundle verifies it:

```cpp
#include <esp_crt_bundle.h>
#include <esp_http_client.h>

int provision(const std::string& key, const std::string& body, std::string& out) {
    esp_http_client_config_t cfg = {};
    cfg.url = "https://api.paqett.com/v1/devices/provision";
    cfg.method = HTTP_METHOD_POST;
    cfg.timeout_ms = 15000;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
    cfg.disable_auto_redirect = true;  // never replay the bearer token elsewhere

    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) return -1;
    const std::string auth = "Bearer " + key;
    esp_http_client_set_header(c, "Content-Type", "application/json");
    esp_http_client_set_header(c, "Accept", "application/json");
    esp_http_client_set_header(c, "Authorization", auth.c_str());

    int status = -1;
    if (esp_http_client_open(c, body.size()) == ESP_OK &&
        esp_http_client_write(c, body.data(), body.size()) == (int)body.size() &&
        esp_http_client_fetch_headers(c) >= 0) {
        status = esp_http_client_get_status_code(c);
        char buf[512];
        int n;
        while ((n = esp_http_client_read(c, buf, sizeof buf)) > 0 && out.size() < 16 * 1024)
            out.append(buf, n);
    }
    esp_http_client_close(c);
    esp_http_client_cleanup(c);
    return status;
}
```

A `200` returns everything the device needs:

```json
{
  "device_id": "3f6c2a9e-8d41-4b7a-9c35-1e2f4a6b8c0d",
  "cert_pem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n",
  "ca_pem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n",
  "mqtt_host": "mqtt.paqett.com",
  "mqtt_port": 8883,
  "topic_prefix": "devices/3f6c2a9e-8d41-4b7a-9c35-1e2f4a6b8c0d",
  "cert_not_after": "2031-11-19T12:00:00Z"
}
```

The certificate is valid for 5 years and backdated 5 minutes. `cert_not_after` is its expiry in ISO 8601. `ca_pem` is the device CA, which also signed the broker's certificate, so it is the only trust anchor the device needs for MQTT.

Validate before you store anything. The SDK checks that `device_id` is a UUID, that both PEM fields contain a certificate, that the port is in range, and that `topic_prefix` equals `devices/` plus the `device_id`. A prefix that disagreed with the id would have the device publishing where the broker won't let it.

## Step 5: Store the client certificate and the CA

The SDK keeps the response in a second NVS namespace, `ipn_crt`: `device_id`, `cert_pem`, `ca_pem`, `mqtt_host`, `mqtt_port` and `topic_prefix`. The write order matters. It removes the old certificate first and writes the new one last. A power cut part-way through leaves an incomplete record, which reads back as "not provisioned" and triggers a clean re-enrolment, never a certificate paired with the wrong CA or id.

## Step 6: Connect esp-mqtt with a client certificate

esp-mqtt takes the CA, the client certificate and the private key as PEM strings. It keeps pointers into them for the life of the client, so they must outlive it.

```cpp
#include <mqtt_client.h>

// Loaded from NVS. esp-mqtt points into these; keep them alive.
static std::string g_host, g_ca, g_cert, g_key, g_device_id, g_status;
static uint16_t g_port;
static const char kOffline[] = "{\"online\":false}";

esp_mqtt_client_handle_t mqtt_start() {
    esp_mqtt_client_config_t cfg = {};
    cfg.broker.address.hostname = g_host.c_str();             // mqtt_host
    cfg.broker.address.port = g_port;                          // mqtt_port, 8883
    cfg.broker.address.transport = MQTT_TRANSPORT_OVER_SSL;
    cfg.broker.verification.certificate = g_ca.c_str();        // ca_pem, not public roots
    cfg.credentials.client_id = g_device_id.c_str();
    cfg.credentials.authentication.certificate = g_cert.c_str();  // cert_pem
    cfg.credentials.authentication.key = g_key.c_str();           // key_pem from NVS
    cfg.session.last_will.topic = g_status.c_str();            // devices/<id>/status
    cfg.session.last_will.msg = kOffline;
    cfg.session.last_will.msg_len = sizeof kOffline - 1;
    cfg.session.last_will.qos = 1;
    cfg.session.last_will.retain = true;
    cfg.session.keepalive = 60;
    cfg.session.protocol_ver = MQTT_PROTOCOL_V_3_1_1;
    cfg.network.disable_auto_reconnect = true;  // own back-off, see below
    cfg.network.timeout_ms = 10000;
    cfg.buffer.size = 2048;

    esp_mqtt_client_handle_t c = esp_mqtt_client_init(&cfg);
    if (!c) return nullptr;
    esp_mqtt_client_register_event(c, MQTT_EVENT_ANY, on_mqtt_event, nullptr);
    if (esp_mqtt_client_start(c) != ESP_OK) {
        esp_mqtt_client_destroy(c);
        return nullptr;
    }
    return c;
}
```

Three details carry the security:

- **Trust only `ca_pem`.** Don't attach the public certificate bundle to the MQTT client. The broker's certificate chains to the device CA, not to a public root.
- **Keep the hostname check.** `skip_cert_common_name_check` stays false, so esp-tls checks the broker's certificate against `mqtt_host`. Connect by that hostname, never by IP address.
- **The client id doesn't matter to the broker.** It overwrites both username and client id with the CN of your certificate. The SDK sends the `device_id` anyway, so its logs match.

## Step 7: Retained status, hello, last will and commands

The last will is the retained `{"online":false}` on `devices/<id>/status`, so the broker announces the device offline when the connection drops. On every connect the device does the opposite and says hello:

```cpp
static void on_mqtt_event(void* arg, esp_event_base_t base, int32_t id, void* data) {
    auto e = static_cast<esp_mqtt_event_handle_t>(data);
    switch (e->event_id) {
        case MQTT_EVENT_CONNECTED:
            esp_mqtt_client_publish(e->client, status_topic, "{\"online\":true}", 0, 1, 1);  // QoS 1, retained
            esp_mqtt_client_subscribe(e->client, cmd_filter, 1);   // devices/<id>/cmd/#
            esp_mqtt_client_subscribe(e->client, ota_topic, 1);    // devices/<id>/ota
            esp_mqtt_client_publish(e->client, hello_topic, hello_json, 0, 1, 0);       // QoS 1, not retained
            break;
        case MQTT_EVENT_DATA:
            // A command arrives on devices/<id>/cmd/<name>. Large payloads come in
            // pieces: the topic is set only when current_data_offset is 0.
            break;
        default:
            break;
    }
}
```

The hello on `devices/<id>/hello` tells the platform what is running:

```json
{"hardware_id":"esp32c6-40ac1b2c3d4e","model":"esp32c6-devkit","firmware":"0.3.0","reset_reason":"poweron","uptime_ms":5321,"rssi":-61,"ip":"192.168.1.42"}
```

`reset_reason` comes from `esp_reset_reason()`, and `rssi` and `ip` from the Wi-Fi interface.

Commands arrive on `devices/<id>/cmd/<name>`. The device answers on `devices/<id>/cmd_ack` with `{"cmd":"ping","ok":true}`, or `ok: false` and an `error` for a command it doesn't know. `cmd_ack` sits outside `cmd/#` on purpose, so the device never hears its own acknowledgements.

> **Note:** A graceful MQTT DISCONNECT suppresses the last will. When the SDK closes a session itself, it publishes the retained `{"online":false}` first and then stops the client.

The SDK doesn't publish from the event handler directly. esp-mqtt raises events on its own task, so the SDK queues them and replays them on the main loop, tagging each session with a generation number so a late event from a torn-down session is dropped.

### Retries and back-off

The SDK disables esp-mqtt's auto-reconnect and runs its own exponential back-off with jitter. Each delay is drawn from the upper half of the nominal value, so a fleet doesn't retry in lockstep after an outage.

| Situation | What the SDK does |
| --- | --- |
| Provisioning: network error, 5xx, 408, malformed reply | back-off from 5 s, capped at 5 min |
| Provisioning: 429 | the larger of the back-off and `Retry-After` (seconds; capped at a day) |
| Provisioning: 400, 401, 403, 409 | wait 30 min; a human has to fix something |
| MQTT connect fails or drops | back-off from 2 s, capped at 5 min; reset after 60 s online |
| No result from a connect attempt | abandoned after 30 s |
| Broker rejects the identity 3 times in a row | drop the certificate, keep the key, re-provision |

Changing the API key or URL over the SDK's serial console resets the provisioning back-off and retries at once.

## Re-provisioning, renewal and revocation

**Same key, new certificate.** Calling `POST /v1/devices/provision` again with the same `hardware_id` re-provisions: the device keeps its `device_id` and gets a new certificate. This covers a lost certificate and renewal before `cert_not_after`. The old certificate stays valid until it is revoked.

**Re-provisioning is pinned to the key.** While a device holds an unrevoked certificate, a new request must carry a CSR for the same public key. A different key gets a `409`. Without the pin, anyone who read the provisioning key out of one device could enrol their own key under another device's id and take it over.

**A device that lost its key.** After a factory reset or an NVS wipe, the device makes a new key and its next enrolment is refused with `409`. Revoke the device's certificates in the Paqett console. Revocation clears the pin, so the device enrols with its new key and keeps its `device_id`.

**Revocation.** Revoking a device revokes every live certificate and disconnects it straight away. The broker publishes the device's last will, so it shows offline. A revoked certificate is refused on every later CONNECT with `not authorised`.

> **Warning:** Revocation is per certificate, not per device. A certificate issued after the revocation connects. A revoked device that still holds a valid provisioning key can enrol again, and the SDK does exactly that after three rejected connects. To keep a device out for good, also revoke the provisioning key it carries. That stops enrolment, and re-enrolment, for every device holding that key. Enrolled devices keep connecting, and new devices need a new key.

## Troubleshooting

### Provisioning errors

Error responses carry `error.code` and `error.message` in the body. The SDK logs both.

| Status | Cause | Fix |
| --- | --- | --- |
| `400` | A field breaks the contract; `csr_pem: ...` points at the CSR | Check the `hardware_id` pattern, field lengths and that the CSR is EC P-256 with ECDSA-SHA256 |
| `401` | The key is wrong or revoked | Check the `pq_live_...` key on the device |
| `403` | The key lacks the `devices:provision` scope | Create a key with that scope in the console |
| `409` | A different key for an already enrolled device, or the `hardware_id` belongs to another project | Revoke the device's certificates, or enrol it with that project's key |
| `429` | Rate limited | Wait for `Retry-After` |

### ESP32 TLS handshake failed

esp-mqtt reports these as `MQTT_EVENT_ERROR` with `error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT`. Log the whole error handle; one line usually names the cause:

```cpp
case MQTT_EVENT_ERROR: {
    const esp_mqtt_error_codes_t* ec = e->error_handle;
    if (ec->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) {
        ESP_LOGW(TAG, "transport esp=%s tls=-0x%04x verify_flags=0x%x errno=%d",
                 esp_err_to_name(ec->esp_tls_last_esp_err), (unsigned)-ec->esp_tls_stack_err,
                 (unsigned)ec->esp_tls_cert_verify_flags, ec->esp_transport_sock_errno);
    } else if (ec->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED) {
        ESP_LOGW(TAG, "CONNACK refused, return code %d", (int)ec->connect_return_code);
    }
    break;
}
```

The SDK silences the IDF tags `esp-tls`, `esp-tls-mbedtls`, `transport_base`, `HTTP_CLIENT` and `mqtt_client` by default. Turn them back on with `esp_log_level_set` when you debug a handshake.

| Symptom | Likely cause |
| --- | --- |
| `tls=-0x7780` (`MBEDTLS_ERR_SSL_FATAL_ALERT_MESSAGE`) | The broker rejected your certificate: wrong or mismatched key, or a certificate from another CA |
| `tls=-0x2700` with `MBEDTLS_X509_BADCERT_NOT_TRUSTED` in the flags | Wrong CA: you passed the public bundle or an old CA instead of `ca_pem` |
| `MBEDTLS_X509_BADCERT_CN_MISMATCH` in the flags | Connected by IP address or another name; use `mqtt_host` |
| `MBEDTLS_X509_BADCERT_FUTURE` or `MBEDTLS_X509_BADCERT_EXPIRED` | The clock is wrong and your build checks certificate dates (see the FAQ) |
| `errno` set, no TLS error | Network: DNS, firewall or no route to port 8883 |

### Connected, then refused

A CONNACK with return code 5 (`not authorised`) after a clean handshake means the broker refused the certificate itself: it is revoked, or it was not issued to this device id. The SDK counts this as an identity rejection, together with bad username and identifier rejected. The broker also refuses with `not authorised` for a few seconds if it can't check the certificate with the platform, because it fails closed. Your back-off rides that out.

### Publishes vanish or subscriptions fail

Everything the device does must sit under `topic_prefix`, `devices/<id>/`. The broker lets a device do nothing else, whatever topic you build. Derive every topic from the stored `topic_prefix` rather than from a hard-coded string.

## FAQ

### Can I use an RSA key instead of EC P-256?

No. The CSR must be for an EC P-256 key, signed with ECDSA-SHA256. P-256 is also the cheaper choice on an ESP32: a small key, small certificates and fast handshakes.

### Do I need SNTP before the TLS connection?

Not with Arduino-ESP32 3.1.3. Its prebuilt mbedTLS has `CONFIG_MBEDTLS_HAVE_TIME_DATE` off, so certificate validity dates aren't checked and the SDK connects without setting the clock. If your own ESP-IDF build turns that option on, sync the time with SNTP before the first connection. Until then the system clock reads 1970, and every certificate looks not yet valid.

### Where should an ESP32 store its private key?

In NVS, as above, never in the firmware image. With NVS encryption and flash encryption enabled, a dumped flash image doesn't expose the key.

### What happens when the certificate expires?

Certificates last 5 years. Enrol again with the same key before `cert_not_after` and the device gets a fresh certificate under the same `device_id`.

### Can I use the same certificate on two devices?

No. The certificate's CN is one device id. The broker uses it as the client id, so a second connection with the same certificate takes over the first one's session.

## Next

- [Provisioning API](/devices/provisioning): every field, rule and error of `POST /v1/devices/provision`.
- [MQTT topics](/devices/mqtt-topics): the full topic map under `devices/<id>/`.
- [ESP32 OTA updates over MQTT](/guides/esp32-ota-updates-over-mqtt): the next guide. Use this same mutual TLS session to deliver firmware.
