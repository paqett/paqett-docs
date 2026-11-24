---
title: "ESP32 TLS handshake failed: mbedTLS error codes and fixes"
nav: "ESP32: TLS handshake errors"
description: "ESP32 TLS handshake failed? Decode the mbedTLS and esp-tls codes ESP-IDF prints, such as -0x2700 and -0x7780, read the verify flags and fix the cause."
tldr: "An ESP32 TLS failure carries up to three numbers: an esp-tls error such as ESP_ERR_MBEDTLS_SSL_HANDSHAKE_FAILED, an mbedTLS code such as -0x2700, and X.509 verify flags. -0x2700 means the ESP32 rejected the server's certificate, and the flags say why. -0x7780 means the server ended the handshake, usually over your client certificate or key."
order: 5
updated: 2026-11-19
keywords: [esp32 tls handshake failed, esp-tls mbedtls_ssl_handshake returned -0x2700, mbedtls -0x7780, esp32 mqtt tls error, MBEDTLS_ERR_X509_CERT_VERIFY_FAILED esp32, esp32 certificate verify failed, x509 verify flags esp32]
about: [tls, mbedtls, esp32, mtls, x509, mqtt, esp-idf, arduino]
---

An ESP32 TLS handshake fails for one of four reasons: the ESP32 rejected the server's certificate, the server rejected the ESP32, the network dropped the connection, or the chip ran out of memory. The mbedTLS code in the log line tells you which. This page maps every code an ESP32 MQTT or HTTPS client realistically hits to its cause and its fix.

Every code and constant here comes from the headers shipped with Arduino-ESP32 3.1.3 (ESP-IDF 5.3, mbedTLS 3.6.2), the stack the Paqett SDK builds on. The same values apply to any ESP-IDF 5.x project.

## How do I read an ESP32 TLS error?

An ESP32 TLS failure reports up to four values: an `esp_err_t` from esp-tls, an mbedTLS error code, the X.509 verify flags and the socket `errno`. Read them in that order. The esp-tls error names the stage that failed, the mbedTLS code names the reason, and the flags explain a certificate rejection.

The familiar log line comes from esp-tls:

```text
E (5321) esp-tls-mbedtls: mbedtls_ssl_handshake returned -0x2700
E (5322) esp-tls: Failed to open new connection
E (5323) transport_base: Failed to open a new connection
E (5330) mqtt_client: Error transport connect
```

mbedTLS error codes are negative 16-bit numbers. Many combine a high-level code with a low-level one: `-0x21E2` is `MBEDTLS_ERR_X509_INVALID_FORMAT` (`-0x2180`) plus `MBEDTLS_ERR_ASN1_UNEXPECTED_TAG` (`-0x0062`). If a code is missing from the table below, subtract the low-level part (the bottom 7 bits) and look up both halves.

> **Warning:** esp-tls stores the mbedTLS code as a positive number. When `esp_tls_stack_err` or the `esp_tls_code` from `esp_tls_get_and_clear_last_error` reads `0x2700`, the mbedTLS error is `-0x2700`. Compare it with `-MBEDTLS_ERR_X509_CERT_VERIFY_FAILED`, not with the constant itself.

## Find your error: ESP32 TLS error code table

Find the code from your log in the first column. The codes are listed as ESP-IDF prints them.

| Code | Constant | Meaning | Most likely cause | Fix |
| --- | --- | --- | --- | --- |
| `-0x2700` | `MBEDTLS_ERR_X509_CERT_VERIFY_FAILED` | The ESP32 rejected the server's certificate | Wrong CA, wrong hostname, or a date check with no clock | Decode the verify flags (next section) |
| `-0x7780` | `MBEDTLS_ERR_SSL_FATAL_ALERT_MESSAGE` | The server sent a fatal TLS alert | The server rejected your client certificate or key, or requires a protocol the ESP32 lacks | See "What does -0x7780 mean?" |
| `-0x7280` | `MBEDTLS_ERR_SSL_CONN_EOF` | The server closed the TCP connection mid-handshake | A non-TLS port, a proxy or firewall closing the socket, or a server refusing without an alert | Check host and port, then the server's log |
| `-0x0050` | `MBEDTLS_ERR_NET_CONN_RESET` | The socket was reset (`ECONNRESET` or `EPIPE`) | The server or a middlebox reset the connection | Check the server's log and the network path |
| `-0x004C` | `MBEDTLS_ERR_NET_RECV_FAILED` | A socket read failed for another reason | Wi-Fi dropped or the route went away | Check `errno` and the Wi-Fi state |
| `-0x7A00` | `MBEDTLS_ERR_SSL_BAD_CERTIFICATE` | The server's Certificate message could not be processed | A malformed or unsupported server certificate | Inspect the server's chain with a desktop TLS client |
| `-0x6E00` | `MBEDTLS_ERR_SSL_HANDSHAKE_FAILURE` | Negotiation failed | No cipher suite, curve or signature algorithm in common | Compare the server's TLS 1.2 settings with the ESP32's |
| `-0x7100` | `MBEDTLS_ERR_SSL_BAD_INPUT_DATA` | An SSL function got invalid arguments | A configuration mistake, for example a hostname over 255 characters | Check what you pass to the client config |
| `-0x7F00` | `MBEDTLS_ERR_SSL_ALLOC_FAILED` | mbedTLS could not allocate memory | Not enough free heap for the TLS buffers | Measure the heap (see below) |
| `-0x2880` | `MBEDTLS_ERR_X509_ALLOC_FAILED` | Out of memory while parsing a certificate | Low heap, or a very large CA chain or bundle | Free heap before connecting |
| `-0x2180` | `MBEDTLS_ERR_X509_INVALID_FORMAT` | A certificate is not valid DER or PEM | A truncated PEM string, or PEM passed with an explicit length | Pass PEM with its terminating NUL and length 0 |
| `-0x3D00` | `MBEDTLS_ERR_PK_KEY_INVALID_FORMAT` | The private key could not be parsed | Not a key, a corrupted key, or a certificate in the key field | Check the key PEM that reaches the client |
| `-0x3C00` | `MBEDTLS_ERR_PK_PASSWORD_REQUIRED` | The key is encrypted | A password-protected PEM key | Store the key unencrypted and protect it with NVS and flash encryption |
| `-0x3F00` | `MBEDTLS_ERR_PK_TYPE_MISMATCH` | The key type does not fit the operation | An RSA key where an EC key is expected, or the reverse | Make the key match the certificate |
| `-0x6900` | `MBEDTLS_ERR_SSL_WANT_READ` | No data yet: call again | Normal on non-blocking sockets | Not an error. esp-tls retries until its timeout |
| `-0x6800` | `MBEDTLS_ERR_SSL_TIMEOUT` | An mbedTLS read timed out | Only with an mbedTLS read timeout configured | A connect timeout shows as `ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT` instead |

### esp-tls errors (ESP_ERR_ESP_TLS_*)

The esp-tls error names the stage that failed. `esp_err_to_name()` prints these names, because Arduino-ESP32 3.1.3 builds with `CONFIG_ESP_ERR_TO_NAME_LOOKUP` on.

| Value | Name | What failed |
| --- | --- | --- |
| `0x8001` | `ESP_ERR_ESP_TLS_CANNOT_RESOLVE_HOSTNAME` | DNS lookup of the host |
| `0x8002` | `ESP_ERR_ESP_TLS_CANNOT_CREATE_SOCKET` | Creating the socket |
| `0x8004` | `ESP_ERR_ESP_TLS_FAILED_CONNECT_TO_HOST` | The TCP connect; `errno` holds the reason, such as `ECONNREFUSED` |
| `0x8006` | `ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT` | TCP connect or handshake did not finish within the timeout |
| `0x8008` | `ESP_ERR_ESP_TLS_TCP_CLOSED_FIN` | The server closed the connection cleanly while the client was reading |
| `0x8015` | `ESP_ERR_MBEDTLS_X509_CRT_PARSE_FAILED` | Parsing the CA or client certificate |
| `0x8016` | `ESP_ERR_MBEDTLS_SSL_CONF_OWN_CERT_FAILED` | Loading the client certificate and key into mbedTLS |
| `0x8017` | `ESP_ERR_MBEDTLS_SSL_SETUP_FAILED` | SSL setup, including "no server verification option set" |
| `0x8019` | `ESP_ERR_MBEDTLS_PK_PARSE_KEY_FAILED` | Parsing the client private key |
| `0x801A` | `ESP_ERR_MBEDTLS_SSL_HANDSHAKE_FAILED` | The handshake itself; the mbedTLS code says why |

When the esp-tls error is `ESP_ERR_MBEDTLS_SSL_HANDSHAKE_FAILED`, the TCP connection worked and the problem is TLS. When it is one of the `ESP_ERR_ESP_TLS_*` connect errors and the mbedTLS code is 0, the ESP32 never reached a TLS server.

### Why does the ESP32 time out during the TLS handshake?

`ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT` means the TCP connect, or the connect and handshake together, did not finish within the client's timeout. The timeout is `network.timeout_ms` in esp-mqtt and `timeout_ms` in esp_http_client. No mbedTLS code comes with it, because nothing failed: the server simply did not answer in time.

The common causes are a firewall that silently drops packets to the port, a service that accepts the TCP connection but never answers the TLS ClientHello, and a weak Wi-Fi link that loses packets during the handshake. Check the port first. Then raise the timeout to 10 to 15 seconds and see whether the error turns into a real one.

## What does -0x2700 mean on an ESP32?

`-0x2700` (`MBEDTLS_ERR_X509_CERT_VERIFY_FAILED`) means the ESP32 checked the server's certificate and rejected it. The verify flags hold the reason. esp-tls records them whenever a handshake fails and a CA, a global CA store or the certificate bundle is configured.

### How do I decode the X.509 verify flags?

The verify flags are a bit mask: add up the bits that are set. `0x0C`, for example, is `MBEDTLS_X509_BADCERT_CN_MISMATCH` (`0x04`) plus `MBEDTLS_X509_BADCERT_NOT_TRUSTED` (`0x08`). These are the certificate bits from `mbedtls/x509.h`:

| Bit | Constant | Meaning | Usual cause on an ESP32 |
| --- | --- | --- | --- |
| `0x01` | `MBEDTLS_X509_BADCERT_EXPIRED` | Validity period has ended | Expired server certificate, or a clock set in the future |
| `0x02` | `MBEDTLS_X509_BADCERT_REVOKED` | Listed on a CRL | Needs a CRL; esp-tls configures none, so this does not appear |
| `0x04` | `MBEDTLS_X509_BADCERT_CN_MISMATCH` | Name does not match the host | Connected by IP address or by a name the certificate does not carry |
| `0x08` | `MBEDTLS_X509_BADCERT_NOT_TRUSTED` | Chain does not end at a trusted CA | Wrong CA PEM, an old CA, or the server sends an incomplete chain |
| `0x40` | `MBEDTLS_X509_BADCERT_MISSING` | No certificate | The server sent none |
| `0x80` | `MBEDTLS_X509_BADCERT_SKIP_VERIFY` | Verification was skipped | Verification turned off |
| `0x0100` | `MBEDTLS_X509_BADCERT_OTHER` | Other reason | Set by a custom verify callback |
| `0x0200` | `MBEDTLS_X509_BADCERT_FUTURE` | Validity has not started | Clock behind the certificate's start date, typically 1970 |
| `0x0800` | `MBEDTLS_X509_BADCERT_KEY_USAGE` | keyUsage forbids this use | Wrong certificate profile on the server |
| `0x1000` | `MBEDTLS_X509_BADCERT_EXT_KEY_USAGE` | extendedKeyUsage forbids this use | A client-only certificate installed on the server |
| `0x2000` | `MBEDTLS_X509_BADCERT_NS_CERT_TYPE` | nsCertType forbids this use | Legacy Netscape extension on the server certificate |
| `0x4000` | `MBEDTLS_X509_BADCERT_BAD_MD` | Unacceptable signature hash | SHA-1 signature; the default profile accepts SHA-256 and above |
| `0x8000` | `MBEDTLS_X509_BADCERT_BAD_PK` | Unacceptable signature algorithm | Key algorithm not allowed by the profile |
| `0x010000` | `MBEDTLS_X509_BADCERT_BAD_KEY` | Unacceptable key | RSA under 2048 bits, or a curve the profile does not allow |

The remaining bits (`0x10`, `0x20`, `0x0400`, `0x020000`, `0x040000`, `0x080000`) describe CRLs and appear only when you load one.

`mbedtls_x509_crt_verify_info()` turns the flags into text, one line per bit. The snippet further down prints it.

### Fixing NOT_TRUSTED and CN_MISMATCH

Most `-0x2700` errors are `NOT_TRUSTED`, `CN_MISMATCH` or both:

- **`NOT_TRUSTED` on a private broker.** Give the client the CA that signed the broker's certificate. On Paqett that is the `ca_pem` from [provisioning](/devices/provisioning), never the public certificate bundle: the broker's certificate chains to the device CA, not to a public root.
- **`NOT_TRUSTED` on a public HTTPS server.** Attach the certificate bundle (`crt_bundle_attach = esp_crt_bundle_attach`). Arduino-ESP32 3.1.3 ships the full bundle.
- **`CN_MISMATCH`.** Connect by the hostname in the certificate. mbedTLS checks the subjectAltName entries when the certificate has them, and the CN only when it has none. Connecting by IP address fails unless the certificate lists that address.

## What does -0x7780 mean on an ESP32?

`-0x7780` (`MBEDTLS_ERR_SSL_FATAL_ALERT_MESSAGE`) means the server sent a fatal TLS alert and ended the handshake. The ESP32 accepted everything up to that point. The verify flags are 0, and the reason lives on the server.

The usual causes for an ESP32 client:

1. **The server rejected the client certificate.** It was issued by a CA the server does not trust, or the client sent none to a server that requires one.
2. **The private key does not match the certificate.** esp-tls parses the key and the certificate separately and never checks that they pair. The mismatch only shows when the server fails to verify the handshake signature and sends an alert.
3. **No protocol in common.** Arduino-ESP32 3.1.3 builds mbedTLS with TLS 1.2 only (`CONFIG_MBEDTLS_SSL_PROTO_TLS1_3` is off). A server that accepts only TLS 1.3 ends the handshake with an alert.

The alert number is visible only in the server's log, or on the ESP32 with mbedTLS debug output, which the Arduino build leaves out (`CONFIG_MBEDTLS_DEBUG` off). Check the server side first.

## How do I get the full error out of esp-mqtt?

esp-mqtt hands every failure to `MQTT_EVENT_ERROR` with an `esp_mqtt_error_codes_t` in `event->error_handle`. For a transport failure, `error_type` is `MQTT_ERROR_TYPE_TCP_TRANSPORT` and four fields carry the detail: `esp_tls_last_esp_err`, `esp_tls_stack_err`, `esp_tls_cert_verify_flags` and `esp_transport_sock_errno`. For a broker refusal after a good handshake, `error_type` is `MQTT_ERROR_TYPE_CONNECTION_REFUSED` and `connect_return_code` holds the CONNACK code.

```cpp
#include <esp_err.h>
#include <esp_log.h>
#include <mbedtls/error.h>
#include <mbedtls/x509_crt.h>
#include <mqtt_client.h>

static const char* TAG = "app";

static void log_mqtt_error(const esp_mqtt_error_codes_t* ec) {
    if (!ec) return;
    if (ec->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED) {
        // TLS succeeded; the broker refused the MQTT CONNECT.
        ESP_LOGE(TAG, "CONNACK refused, return code %d", (int)ec->connect_return_code);
        return;
    }
    if (ec->error_type != MQTT_ERROR_TYPE_TCP_TRANSPORT) {
        ESP_LOGE(TAG, "mqtt error type %d", (int)ec->error_type);
        return;
    }
    // esp-tls stores the mbedTLS code as a positive number: 0x2700 is -0x2700.
    const int tls = ec->esp_tls_stack_err;
    const uint32_t flags = (uint32_t)ec->esp_tls_cert_verify_flags;
    char text[100] = "";
    if (tls != 0) mbedtls_strerror(-tls, text, sizeof text);
    ESP_LOGE(TAG, "esp=%s tls=-0x%04x (%s) flags=0x%x errno=%d",
             esp_err_to_name(ec->esp_tls_last_esp_err), (unsigned)tls, text,
             (unsigned)flags, ec->esp_transport_sock_errno);
    if (flags != 0) {
        char info[256];
        mbedtls_x509_crt_verify_info(info, sizeof info, "  ! ", flags);
        ESP_LOGE(TAG, "certificate rejected:\n%s", info);
    }
}

// In your MQTT event handler:
//   case MQTT_EVENT_ERROR: log_mqtt_error(event->error_handle); break;
```

`mbedtls_strerror` prints the constant's description, because Arduino-ESP32 3.1.3 builds with `CONFIG_MBEDTLS_ERROR_STRINGS` on.

## How do I get the TLS error from esp_http_client?

esp_http_client passes the esp-tls error handle as `evt->data` in `HTTP_EVENT_ERROR`, which fires when `esp_http_client_open()` or `esp_http_client_perform()` fails to connect. Read it with `esp_tls_get_and_clear_last_error()`:

```cpp
#include <esp_http_client.h>
#include <esp_log.h>
#include <esp_tls.h>

static esp_err_t on_http_event(esp_http_client_event_t* evt) {
    if (evt->event_id == HTTP_EVENT_ERROR && evt->data) {
        int tls = 0, flags = 0;
        const esp_err_t esp = esp_tls_get_and_clear_last_error(
            static_cast<esp_tls_error_handle_t>(evt->data), &tls, &flags);
        ESP_LOGE("https", "esp=%s tls=-0x%04x flags=0x%x errno=%d", esp_err_to_name(esp),
                 (unsigned)tls, (unsigned)flags, esp_http_client_get_errno(evt->client));
    }
    return ESP_OK;
}

// cfg.event_handler = on_http_event;
```

The call clears the stored error. Read it once, in the first handler that sees it.

## How do I turn the ESP-IDF TLS logs back on?

Call `esp_log_level_set()` with `ESP_LOG_ERROR` or higher for the tags `esp-tls`, `esp-tls-mbedtls`, `transport_base`, `mqtt_client` and `HTTP_CLIENT`. The Paqett SDK sets all five to `ESP_LOG_NONE` at boot, because the stack logs every refused connection mid-line with its own output. Build with `IPNODE_QUIET_IDF_LOGS=0` to keep them.

```cpp
for (const char* tag : {"esp-tls", "esp-tls-mbedtls", "transport_base", "mqtt_client", "HTTP_CLIENT"})
    esp_log_level_set(tag, ESP_LOG_VERBOSE);
```

On Arduino-ESP32 3.1.3 this restores the error lines only. The prebuilt ESP-IDF libraries are compiled with `CONFIG_LOG_MAXIMUM_LEVEL` at ERROR, so the info and debug messages, such as "Failed to verify peer certificate!", are not in the binary at all. The error handle above carries the same information. In a plain ESP-IDF build, raise the default log level to Debug and esp-tls also prints the decoded verify flags.

## Does the ESP32 need the correct time for TLS?

Only if mbedTLS checks certificate dates, which depends on `CONFIG_MBEDTLS_HAVE_TIME_DATE`. Arduino-ESP32 3.1.3 builds with it off for the ESP32-C6, so mbedTLS never sets the `EXPIRED` or `FUTURE` flags and the ESP32 connects with its clock at 1970. The same build also accepts an expired server certificate.

With the option on, the system clock starts at 1970 after boot, so every certificate looks not yet valid and verification fails with `MBEDTLS_X509_BADCERT_FUTURE` (`0x0200`). Sync the time with SNTP and wait for it before the first TLS connection.

## How much heap does an ESP32 TLS connection need?

Espressif measured about 42,196 bytes of heap for its `https_request` example with server validation and default mbedTLS settings. Enabling dynamic TX/RX buffers brought that to about 22,013 bytes. Arduino-ESP32 3.1.3 sets `CONFIG_MBEDTLS_SSL_MAX_CONTENT_LEN` to 16384 for both directions, so plan for the default figure plus your own certificates.

What matters is the largest free block, not only the total. Log both right before connecting:

```cpp
#include <esp_heap_caps.h>
#include <esp_system.h>

ESP_LOGI("heap", "free=%u min=%u largest=%u",
         (unsigned)esp_get_free_heap_size(), (unsigned)esp_get_minimum_free_heap_size(),
         (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
```

If the largest block falls short when `-0x7F00` or `-0x2880` appears, free memory first: destroy an old client before starting a new one, and release large buffers before you connect.

## Why does my ESP32 mutual TLS connection fail?

Mutual TLS adds failures the ESP32 cannot see in its own verify flags, because the server is the one checking. Where the failure appears tells you what broke:

| What you see | Cause | Fix |
| --- | --- | --- |
| `ESP_ERR_MBEDTLS_PK_PARSE_KEY_FAILED`, before any network traffic | The key PEM is empty, truncated or encrypted | Check the key you load from storage |
| `-0x7780` during the handshake | Wrong key for the certificate, a certificate from another CA, or no certificate sent | Pair the key and certificate from one enrolment; use the certificate the server's CA issued |
| CONNACK return code 5, `MQTT_CONNECTION_REFUSE_NOT_AUTHORIZED` | The handshake passed; the broker refused the identity | The certificate is revoked or not issued to this device |
| CONNACK return code 4 or 2 | Bad username, or identifier rejected | Check what the broker derives from the certificate |

On Paqett the CN of the certificate is the device id, and the broker takes the MQTT username and client id from it. A revoked certificate passes the TLS handshake and is then refused with `not authorised`. The broker also refuses with `not authorised` for a few seconds when it cannot check a certificate with the platform, because it fails closed. Back off and retry. [Provisioning](/devices/provisioning) explains revocation and re-keying, and the [mutual TLS guide](/guides/esp32-mqtt-mutual-tls-x509) shows the full client setup.

A key that does not match its certificate usually means a new key was generated while the old certificate stayed in storage. Delete the stored certificate whenever you generate a new key, then enrol again.

## FAQ

### Why does my ESP32 say "mbedtls_ssl_handshake returned -0x2700"?

The ESP32 rejected the server's certificate. Read `esp_tls_cert_verify_flags` from the MQTT error handle, or the flags from `esp_tls_get_and_clear_last_error`. A value of `0x08` means the CA you gave does not sign the server's certificate. `0x04` means the hostname does not match.

### What is mbedTLS error -0x7780?

It is `MBEDTLS_ERR_SSL_FATAL_ALERT_MESSAGE`: the server sent a fatal alert and closed the handshake. With a client certificate it almost always means the server did not accept that certificate or its key. Look in the server's log for the alert reason.

### Why do esp_tls_stack_err values look positive?

esp-tls stores the magnitude of the mbedTLS error. A value of `0x2700` stands for `-0x2700`. Print it as `-0x%04x` and compare it against the negated constant.

### Can I skip certificate verification on the ESP32 to make the error go away?

Skipping verification lets anyone on the network impersonate your server and read the traffic, including anything the device sends after the handshake. ESP-IDF refuses a TLS client with no CA unless you enable an insecure option on purpose. Fix the CA or the hostname instead.

### Why does the ESP32 connect over TLS and then get "not authorised"?

The TLS handshake succeeded, so the certificates are valid. The MQTT broker then refused the identity in the certificate at CONNECT, with CONNACK return code 5. On Paqett that means the certificate has been revoked, was not issued to this device, or could not be checked for a moment.

## Related

- [ESP32 MQTT over mutual TLS with an X.509 client certificate](/guides/esp32-mqtt-mutual-tls-x509)
- [Provisioning API](/devices/provisioning)
- [What is MQTT mutual TLS?](/learn/mqtt-mutual-tls)
- [Generate a CSR on the ESP32 with mbedTLS](/guides/esp32-generate-csr-mbedtls)

## Sources

- [ESP-TLS, ESP-IDF Programming Guide](https://docs.espressif.com/projects/esp-idf/en/v5.3.2/esp32c6/api-reference/protocols/esp_tls.html): esp-tls error handle, `esp_tls_get_and_clear_last_error` and the mbedTLS heap figures for ESP-TLS.
- [Mbed TLS, ESP-IDF Programming Guide](https://docs.espressif.com/projects/esp-idf/en/v5.3.2/esp32c6/api-reference/protocols/mbedtls.html): the heap usage table for the `https_request` example (42,196 B default, 22,013 B with dynamic buffers).
- [ESP-MQTT, ESP-IDF Programming Guide](https://docs.espressif.com/projects/esp-idf/en/v5.3.2/esp32c6/api-reference/protocols/mqtt.html): `MQTT_EVENT_ERROR` and the error handle.
- [mbedtls/x509.h in Mbed TLS 3.6.2](https://github.com/Mbed-TLS/mbedtls/blob/v3.6.2/include/mbedtls/x509.h): X.509 error codes and the `MBEDTLS_X509_BADCERT_*` verify flag bits.
- [mbedtls/ssl.h in Mbed TLS 3.6.2](https://github.com/Mbed-TLS/mbedtls/blob/v3.6.2/include/mbedtls/ssl.h): SSL error codes and alert message numbers.
- [RFC 5246, TLS 1.2](https://www.rfc-editor.org/rfc/rfc5246): the alert protocol a server uses to end a handshake.
