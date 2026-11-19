---
title: "ESP32: generate an EC P-256 key and a CSR with mbedTLS"
nav: "ESP32: generate a key and CSR"
description: "Generate a CSR on an ESP32 with mbedTLS: seed CTR_DRBG, make an EC P-256 key, write key and CSR as PEM, keep both in NVS and verify the CSR with OpenSSL."
tldr: "Start Wi-Fi so the ESP32 hardware RNG is truly random, seed mbedTLS CTR_DRBG from it, generate a SECP256R1 key with mbedtls_ecp_gen_key and write it with mbedtls_pk_write_key_pem. Build a SHA-256 PKCS#10 request with mbedtls_x509write_csr. The key PEM is 227 bytes, the CSR about 370. Keep both in NVS; send only the CSR."
order: 3
updated: 2026-11-19
keywords: [esp32 generate csr, mbedtls generate csr, esp32 generate private key, mbedtls_x509write_csr example, esp32 ecdsa p-256 key, esp32 certificate signing request]
about: [csr, mbedtls, esp32, ecc, x509, pki, nvs, esp-idf, arduino]
---

An ESP32 generates its own certificate signing request with the mbedTLS that ships inside ESP-IDF: seed a CTR_DRBG from the hardware RNG, generate an EC key on SECP256R1, then sign a PKCS#10 request with `mbedtls_x509write_csr`. The private key stays in the chip's NVS and only the CSR, which carries the public key, leaves the device.

The code below is adapted from the Paqett SDK's ESP32-C6 adapter and calls mbedTLS directly. It was written against Arduino-ESP32 3.1.3, which bundles ESP-IDF 5.3.2 and mbedTLS 3.6.2, and it works unchanged in a plain ESP-IDF 5.x project.

## Why generate the private key on the ESP32?

Generating the key on the device means the private key never exists anywhere else. Nothing secret has to be flashed at the factory, copied through a build server or held in a database.

The alternative, generating keys on a PC and flashing them in, puts every device's key on a machine you then have to protect for the life of the fleet. With on-device generation, the only thing that travels is the CSR. A CSR holds the subject, the public key and a signature made with the private key, which proves the requester holds that key. Anyone can read it and nobody can use it to impersonate the device.

It also makes enrolment self-service. A device that boots with no identity makes one, sends the CSR to a provisioning endpoint and gets a certificate back, as in the [mutual TLS guide](/guides/esp32-mqtt-mutual-tls-x509).

## Where does the ESP32 get entropy for the key?

The ESP32 hardware RNG produces true random numbers only while the RF subsystem is running (Wi-Fi, Bluetooth or 802.15.4), while the internal SAR ADC entropy source is enabled with `bootloader_random_enable()`, or while the second-stage bootloader runs. Otherwise Espressif says its output "should be considered as pseudo-random only".

ESP-IDF's mbedTLS port defines `MBEDTLS_ENTROPY_HARDWARE_ALT`, so `mbedtls_entropy_func` reads that same hardware RNG. Nothing in that path reports whether the radio is on, so a key generated before it starts looks exactly like a good one. That is why the SDK starts Wi-Fi in station mode before it touches the key, with this comment in `esp_identity.cpp`:

```cpp
// On the ESP32 the entropy source is the hardware RNG, which is truly
// random once the RF subsystem is running (Wi-Fi is started at boot
// before anything here runs).
```

On Arduino-ESP32, `WiFi.mode(WIFI_STA)` calls `esp_wifi_start()`, which is enough: the radio does not need to be associated with an access point. In a plain IDF app, call `esp_wifi_start()` first, or bracket key generation with `bootloader_random_enable()` and `bootloader_random_disable()` if the product has no radio running at that moment.

The CTR_DRBG on top is what Espressif recommends: a strong software DRBG seeded with true random numbers from the hardware RNG.

## Step 1: Start the radio

Turn on Wi-Fi before any mbedTLS call that draws random numbers. On Arduino this is one line in `setup()`:

```cpp
#include <WiFi.h>

void setup() {
    WiFi.mode(WIFI_STA);  // RF on: the hardware RNG is now a true RNG
    // ... key generation may run from here on
}
```

## Step 2: Seed CTR_DRBG

`mbedtls_ctr_drbg_seed` pulls entropy through `mbedtls_entropy_func` and mixes in a personalisation string. The string only separates this DRBG instance from others in the firmware; it is not a secret.

```cpp
mbedtls_entropy_context entropy;
mbedtls_ctr_drbg_context drbg;
mbedtls_entropy_init(&entropy);
mbedtls_ctr_drbg_init(&drbg);

static const char pers[] = "device-identity";
int ret = mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &entropy,
                                reinterpret_cast<const unsigned char*>(pers),
                                sizeof pers - 1);
```

## Step 3: Generate a SECP256R1 key

Set up a PK context for an EC key, then generate the key pair on the P-256 curve (`MBEDTLS_ECP_DP_SECP256R1`, also called prime256v1).

```cpp
mbedtls_pk_context pk;
mbedtls_pk_init(&pk);
ret = mbedtls_pk_setup(&pk, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY));
if (ret == 0)
    ret = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(pk),
                              mbedtls_ctr_drbg_random, &drbg);
```

P-256 is enabled in the Arduino-ESP32 3.1.3 mbedTLS build for the ESP32-C6 (`CONFIG_MBEDTLS_ECP_DP_SECP256R1_ENABLED`), as is the chip's ECC accelerator (`CONFIG_MBEDTLS_HARDWARE_ECC`).

## Step 4: Write the private key as PEM

`mbedtls_pk_write_key_pem` writes the key as a SEC1 `EC PRIVATE KEY` PEM, terminated with a NUL byte.

```cpp
unsigned char key_buf[512];
ret = mbedtls_pk_write_key_pem(&pk, key_buf, sizeof key_buf);
std::string key_pem(reinterpret_cast<const char*>(key_buf));
mbedtls_platform_zeroize(key_buf, sizeof key_buf);
```

The SEC1 structure holds the 32-byte private scalar, the curve OID and the public point, so it is all the device needs to load the key again later.

## Step 5: Build the CSR

Create a CSR writer, point it at the key, choose SHA-256 for the signature and set the subject. With an EC key and SHA-256, mbedTLS signs the request with ECDSA-SHA256.

```cpp
mbedtls_x509write_csr req;
mbedtls_x509write_csr_init(&req);
mbedtls_x509write_csr_set_md_alg(&req, MBEDTLS_MD_SHA256);
mbedtls_x509write_csr_set_key(&req, &pk);
ret = mbedtls_x509write_csr_set_subject_name(&req, "CN=esp32c6-40ac1b2c3d4e");
```

The subject string is a comma-separated list of `NAME=value` pairs, such as `C=UK,O=Example,CN=sensor-1`.

## Step 6: Write the CSR as PEM

`mbedtls_x509write_csr_pem` signs the request and writes it as a `CERTIFICATE REQUEST` PEM. In mbedTLS 3.x it takes an RNG, which is used for the signature operation.

```cpp
unsigned char csr_buf[1024];
ret = mbedtls_x509write_csr_pem(&req, csr_buf, sizeof csr_buf,
                                mbedtls_ctr_drbg_random, &drbg);
std::string csr_pem(reinterpret_cast<const char*>(csr_buf));
```

## Step 7: Free the contexts and zero the buffers

Free every context, in any order, and zero any buffer the private key passed through. `mbedtls_platform_zeroize` is safer than `memset` here because the compiler cannot drop it as a dead store.

```cpp
mbedtls_x509write_csr_free(&req);
mbedtls_pk_free(&pk);
mbedtls_ctr_drbg_free(&drbg);
mbedtls_entropy_free(&entropy);
```

`mbedtls_pk_free` wipes the key material held inside the PK context. The copies in your own buffers and strings are your job.

## The complete function

This is the whole flow in one function, with the CSR writer split out so the rebuild path further down can reuse it. It compiles as-is on Arduino-ESP32 3.x and on ESP-IDF 5.x as C++.

```cpp
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/ecp.h>
#include <mbedtls/entropy.h>
#include <mbedtls/pk.h>
#include <mbedtls/platform_util.h>
#include <mbedtls/x509_csr.h>

#include <string>

// Signs a PKCS#10 request for the key in pk and returns it as PEM.
static int write_csr_pem(mbedtls_pk_context* pk, mbedtls_ctr_drbg_context* drbg,
                         const std::string& cn, std::string& csr_pem) {
    mbedtls_x509write_csr req;
    mbedtls_x509write_csr_init(&req);
    mbedtls_x509write_csr_set_md_alg(&req, MBEDTLS_MD_SHA256);
    mbedtls_x509write_csr_set_key(&req, pk);

    const std::string subject = "CN=" + cn;
    unsigned char buf[1024];
    int ret = mbedtls_x509write_csr_set_subject_name(&req, subject.c_str());
    if (ret == 0)
        ret = mbedtls_x509write_csr_pem(&req, buf, sizeof buf, mbedtls_ctr_drbg_random, drbg);
    if (ret == 0) csr_pem.assign(reinterpret_cast<const char*>(buf));

    mbedtls_x509write_csr_free(&req);
    return ret;
}

// Generates an EC P-256 key and a CSR for it. Call only with the radio on.
// Returns 0 or a negative mbedTLS error code.
int make_key_and_csr(const std::string& cn, std::string& key_pem, std::string& csr_pem) {
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    mbedtls_pk_context pk;
    mbedtls_entropy_init(&entropy);
    mbedtls_ctr_drbg_init(&drbg);
    mbedtls_pk_init(&pk);

    static const char pers[] = "device-identity";
    unsigned char key_buf[512];

    int ret = mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &entropy,
                                    reinterpret_cast<const unsigned char*>(pers), sizeof pers - 1);
    if (ret == 0) ret = mbedtls_pk_setup(&pk, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY));
    if (ret == 0)
        ret = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(pk),
                                  mbedtls_ctr_drbg_random, &drbg);
    if (ret == 0) ret = mbedtls_pk_write_key_pem(&pk, key_buf, sizeof key_buf);
    if (ret == 0) key_pem.assign(reinterpret_cast<const char*>(key_buf));
    if (ret == 0) ret = write_csr_pem(&pk, &drbg, cn, csr_pem);

    mbedtls_platform_zeroize(key_buf, sizeof key_buf);
    mbedtls_pk_free(&pk);
    mbedtls_ctr_drbg_free(&drbg);
    mbedtls_entropy_free(&entropy);
    return ret;
}
```

## How do I store the key and CSR in NVS?

Store both as strings in their own NVS namespace, and write the CSR together with the key so the pair always matches. A dedicated namespace lets you wipe the identity without touching Wi-Fi credentials or settings.

NVS limits keys and namespace names to 15 characters and string values to 4,000 bytes including the terminator. A P-256 key PEM and its CSR fit with plenty of room.

### Arduino-ESP32: Preferences

`Preferences` is a thin wrapper over NVS. The SDK removes the old CSR before it writes the new key, so an interrupted write can never leave a new key paired with an old CSR.

```cpp
#include <Preferences.h>
#include <string>

bool store_identity(const std::string& key_pem, const std::string& csr_pem) {
    Preferences p;
    if (!p.begin("ipn_id", false)) return false;
    if (p.isKey("csr_pem")) p.remove("csr_pem");
    const bool ok = p.putString("key_pem", key_pem.c_str()) == key_pem.size() &&
                    p.putString("csr_pem", csr_pem.c_str()) == csr_pem.size();
    p.end();
    return ok;
}
```

### ESP-IDF: nvs_set_str

In a plain IDF project, call `nvs_flash_init()` once at boot, then use the handle API. `nvs_get_str` with a null buffer returns the length needed, including the terminator.

```cpp
#include <nvs.h>
#include <string>

esp_err_t store_identity(const char* key_pem, const char* csr_pem) {
    nvs_handle_t h;
    esp_err_t err = nvs_open("ipn_id", NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    nvs_erase_key(h, "csr_pem");  // ESP_ERR_NVS_NOT_FOUND on first run is fine
    err = nvs_set_str(h, "key_pem", key_pem);
    if (err == ESP_OK) err = nvs_set_str(h, "csr_pem", csr_pem);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}

esp_err_t load_str(const char* name, std::string& out) {
    nvs_handle_t h;
    esp_err_t err = nvs_open("ipn_id", NVS_READONLY, &h);
    if (err != ESP_OK) return err;
    size_t len = 0;
    err = nvs_get_str(h, name, nullptr, &len);  // len includes the NUL
    if (err == ESP_OK) {
        out.resize(len);
        err = nvs_get_str(h, name, &out[0], &len);
        if (err == ESP_OK) out.resize(len - 1);
    }
    nvs_close(h);
    return err;
}
```

> **Warning:** NVS is plain flash unless you enable NVS encryption. Anyone with the board and a serial adapter can read an unencrypted key out of a flash dump. For production, turn on flash encryption and NVS encryption.

## How do I rebuild a CSR from a stored key?

Parse the stored PEM with `mbedtls_pk_parse_key`, then run the same CSR writer. The SDK does this when it finds a key without a CSR, for example after a power cut between the two NVS writes.

In mbedTLS 3.x, `mbedtls_pk_parse_key` takes an RNG as its last two arguments (used for blinding), and for PEM input `keylen` must be `strlen(key) + 1`: the terminating NUL is part of the input.

```cpp
int rebuild_csr(const std::string& key_pem, const std::string& cn, std::string& csr_pem) {
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    mbedtls_pk_context pk;
    mbedtls_entropy_init(&entropy);
    mbedtls_ctr_drbg_init(&drbg);
    mbedtls_pk_init(&pk);

    static const char pers[] = "device-identity";
    int ret = mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &entropy,
                                    reinterpret_cast<const unsigned char*>(pers), sizeof pers - 1);
    if (ret == 0)
        ret = mbedtls_pk_parse_key(&pk, reinterpret_cast<const unsigned char*>(key_pem.c_str()),
                                   key_pem.size() + 1,  // include the NUL
                                   nullptr, 0,           // not encrypted
                                   mbedtls_ctr_drbg_random, &drbg);
    if (ret == 0 && (mbedtls_pk_get_type(&pk) != MBEDTLS_PK_ECKEY ||
                     mbedtls_ecp_keypair_get_group_id(mbedtls_pk_ec(pk)) != MBEDTLS_ECP_DP_SECP256R1))
        ret = MBEDTLS_ERR_PK_TYPE_MISMATCH;  // stored key is not P-256
    if (ret == 0) ret = write_csr_pem(&pk, &drbg, cn, csr_pem);

    mbedtls_pk_free(&pk);
    mbedtls_ctr_drbg_free(&drbg);
    mbedtls_entropy_free(&entropy);
    return ret;
}
```

The rebuilt CSR carries the same public key as the original. Arduino-ESP32 3.1.3 builds mbedTLS with deterministic ECDSA (`CONFIG_MBEDTLS_ECDSA_DETERMINISTIC`), so the same key and subject give the same signature, and the rebuilt CSR matches the old one byte for byte.

## How big are the key and CSR PEM buffers?

A P-256 key PEM is 227 characters and a CSR with a 20-character CN is about 371, so the SDK's 512-byte key buffer and 1,024-byte CSR buffer leave room to spare. Both functions also write a terminating NUL, so the buffer needs one byte more than the text.

| Output | DER | PEM text | Basis |
| --- | --- | --- | --- |
| SEC1 `EC PRIVATE KEY`, P-256 | 121 bytes | 227 characters | Fixed size: 32-byte scalar, curve OID and 65-byte public point. 164 Base64 characters on 3 lines, plus header and footer. |
| CSR, `CN=` plus 20 characters | 220 to 222 bytes | about 371 characters | 132-byte request info, 12-byte algorithm identifier (ecdsa-with-SHA256, no parameters) and a 73 to 75-byte signature field. 296 Base64 characters on 5 lines, plus header and footer. |

The CSR figures were measured on PKCS#10 requests with the same structure as the mbedTLS output (empty attributes, UTF8String CN). The DER signature varies by a byte or two because ECDSA's `r` and `s` integers sometimes need a leading zero byte. Each extra character of subject adds one byte of DER and about 1.33 characters of PEM.

## What should the CSR subject be?

Use a short, stable string that identifies the chip, such as `CN=` followed by the hardware id. The subject is informational for most enrolment servers: the CA decides what goes into the certificate.

Paqett ignores the CSR subject entirely and sets the certificate's CN to the device id it assigns, as described in the [provisioning API reference](/devices/provisioning). The SDK puts the hardware id, `esp32c6-` plus the base MAC in lower-case hex, in the CN so the CSR is readable in logs. Keep the subject short: it costs flash and bytes on the wire, and nothing reads it.

## How do I verify a CSR on my laptop?

Print the CSR over serial, paste it into `csr.pem` and let OpenSSL parse it and check its signature. The CSR is public, so printing it is safe. Never print the key.

```sh
openssl req -in csr.pem -noout -text -verify
```

A good CSR prints `Certificate request self-signature verify OK` (the wording varies slightly between OpenSSL versions), then the decoded request. Check three lines in the output:

```text
        Subject: CN=esp32c6-40ac1b2c3d4e
                ASN1 OID: prime256v1
    Signature Algorithm: ecdsa-with-SHA256
```

If the self-signature check fails, the CSR was damaged in transit, most often by a lost line break or a truncated buffer when you copied it out of the serial monitor.

## What do the common mbedTLS errors mean?

mbedTLS functions return 0 on success and a negative code on failure. Log the code in hex, and with `CONFIG_MBEDTLS_ERROR_STRINGS` on (the Arduino-ESP32 3.1.3 default) `mbedtls_strerror` turns it into text.

```cpp
#include <mbedtls/error.h>

char msg[128];
mbedtls_strerror(ret, msg, sizeof msg);
printf("mbedTLS error -0x%04x: %s\n", (unsigned)-ret, msg);
```

| Code | Name | Where | Cause and fix |
| --- | --- | --- | --- |
| `-0x0034` | `MBEDTLS_ERR_CTR_DRBG_ENTROPY_SOURCE_FAILED` | `mbedtls_ctr_drbg_seed` | The entropy callback failed. Call `mbedtls_entropy_init` on the context before seeding and pass that same context to the seed call. |
| `-0x3E80` | `MBEDTLS_ERR_PK_BAD_INPUT_DATA` | `mbedtls_pk_setup` | The PK context is already set up, or the key type is not compiled in. Free and re-initialise the context before reuse. |
| `-0x4E80` | `MBEDTLS_ERR_ECP_FEATURE_UNAVAILABLE` | `mbedtls_ecp_gen_key` | The curve is not enabled. Enable `CONFIG_MBEDTLS_ECP_DP_SECP256R1_ENABLED` in menuconfig. |
| `-0x006C` | `MBEDTLS_ERR_ASN1_BUF_TOO_SMALL` | `mbedtls_x509write_csr_pem`, `mbedtls_pk_write_key_pem` | The DER did not fit in the buffer. Use the buffer sizes above. |
| `-0x002A` | `MBEDTLS_ERR_BASE64_BUFFER_TOO_SMALL` | `mbedtls_x509write_csr_pem`, `mbedtls_pk_write_key_pem` | The DER fitted but the PEM did not. Enlarge the buffer; PEM is about a third larger than DER plus headers. |
| `-0x2380` | `MBEDTLS_ERR_X509_INVALID_NAME` | `mbedtls_x509write_csr_set_subject_name` | An attribute name mbedTLS does not know, an empty value or a malformed string. Use standard names such as `CN`, `O` and `C`, and escape a comma inside a value with a backslash. |
| `-0x3D00` | `MBEDTLS_ERR_PK_KEY_INVALID_FORMAT` | `mbedtls_pk_parse_key` | The stored key did not parse. Check that `keylen` includes the NUL, that you read the right NVS key, and that the PEM was not truncated in storage. |

Run key generation and signing from an ordinary task with a generous stack, such as `setup()` or `loop()` on Arduino (the loop task gets 8,192 bytes by default), not from a timer callback or an event handler with a small stack.

## Send it to Paqett

Send the CSR PEM to `POST /v1/devices/provision` along with the hardware id, model and firmware version. The platform checks that it is an EC P-256 request signed with ECDSA-SHA256 and at most 4 KiB, and returns a client certificate, the device CA and the MQTT endpoint.

The [provisioning API reference](/devices/provisioning) lists every field and error. The [mutual TLS guide](/guides/esp32-mqtt-mutual-tls-x509) shows the HTTP request and the MQTT connection that uses the certificate together with the key you just stored.

## FAQ

### Can mbedTLS on an ESP32 generate an RSA key instead?

It can, but an RSA-2048 key takes far longer to generate on an ESP32 than a P-256 key, and both the key and its certificates are much larger. Paqett accepts only EC P-256 CSRs signed with ECDSA-SHA256, so use `MBEDTLS_ECP_DP_SECP256R1`.

### Is it safe to generate the key before Wi-Fi connects?

Yes, as long as the radio is started. The hardware RNG needs the RF subsystem enabled, not an association with an access point. `WiFi.mode(WIFI_STA)` on Arduino, or `esp_wifi_start()` on ESP-IDF, is enough.

### Does mbedtls_pk_write_key_pem write PKCS#8 or SEC1?

For an EC key it writes SEC1, with the header `-----BEGIN EC PRIVATE KEY-----`. `mbedtls_pk_parse_key` reads it back, and so does esp-mqtt when you pass it as the client key.

### Should the ESP32 generate a new key on every boot?

No. Generate the key once, store it in NVS and reuse it. A new key on every boot would force a new certificate each time, and Paqett pins re-provisioning to the device's existing public key, so a changed key is refused with 409 until the device's certificates are revoked.

### Why does the CSR need an RNG if the signature is deterministic?

The mbedTLS 3.x API requires an RNG for the signature operation and for side-channel blinding, whatever the ECDSA mode. Pass the same seeded CTR_DRBG you used for key generation.

## Related

- [ESP32 MQTT over mutual TLS with an X.509 client certificate](/guides/esp32-mqtt-mutual-tls-x509)
- [Provisioning API](/devices/provisioning)
- [Claim certificates vs CSR enrolment](/learn/claim-certificates-vs-csr)
- [ESP32 TLS handshake errors](/guides/esp32-tls-handshake-errors)

## Sources

- [ESP-IDF v5.3: Random number generation (ESP32-C6)](https://docs.espressif.com/projects/esp-idf/en/v5.3/esp32c6/api-reference/system/random.html): when the hardware RNG is a true RNG, and the CTR_DRBG recommendation.
- [ESP-IDF v5.3: Non-volatile storage library (ESP32-C6)](https://docs.espressif.com/projects/esp-idf/en/v5.3/esp32c6/api-reference/storage/nvs_flash.html): key, namespace and string size limits, `nvs_get_str` length queries, NVS encryption.
- [Mbed TLS 3.6.2: x509write_csr.c](https://github.com/Mbed-TLS/mbedtls/blob/v3.6.2/library/x509write_csr.c): how mbedTLS builds, signs and PEM-encodes the CSR.
- [RFC 2986: PKCS #10 Certification Request Syntax](https://www.rfc-editor.org/rfc/rfc2986): the CSR structure.
- [RFC 5915: Elliptic Curve Private Key Structure](https://www.rfc-editor.org/rfc/rfc5915): the SEC1 `EC PRIVATE KEY` format mbedTLS writes.
- [RFC 5480: Elliptic Curve Cryptography Subject Public Key Information](https://www.rfc-editor.org/rfc/rfc5480): the P-256 public key encoding inside the CSR.
