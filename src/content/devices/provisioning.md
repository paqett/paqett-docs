---
title: "Provisioning API: enrol a device for an X.509 certificate"
nav: "Provisioning API"
description: "POST /v1/devices/provision turns a device's CSR into an X.509 client certificate for MQTT over mutual TLS. Fields, responses, errors and re-keying."
tldr: "POST https://api.paqett.com/v1/devices/provision with a project key that has the devices:provision scope and a JSON body of hardware_id, model, firmware and an EC P-256 CSR. The response carries the device id, a five-year client certificate, the CA, the MQTT host and the topic prefix. Re-provisioning must use the same key."
order: 2
updated: 2026-11-19
keywords: [iot device provisioning api, csr to certificate api, x509 client certificate api, device enrolment, certificate signing request iot]
about: [csr, x509, pki, ecc, mtls]
---

A device enrols by sending a certificate signing request (CSR) for its own key. The platform answers with a client certificate for the Paqett MQTT broker, the CA that signed it, and where to connect.

## Request

```text
POST https://api.paqett.com/v1/devices/provision
Authorization: Bearer pq_live_...
Content-Type: application/json
```

```json
{
  "hardware_id": "esp32c6-40ac1b2c3d4e",
  "model": "esp32c6-devkit",
  "firmware": "0.3.0",
  "csr_pem": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----\n"
}
```

The key must carry the `devices:provision` scope. A provisioning key should carry that scope alone: it ships in every device of the fleet, and anyone can read it out of one.

| Field | Rule |
| --- | --- |
| `hardware_id` | Lower-case letters, digits and hyphens, 3 to 64 characters, starting with a letter or digit. The chip's own identity: `esp32c6-` plus the base MAC address on an ESP32-C6. It becomes the device's external id and its name in the console. |
| `model` | 1 to 64 characters. The device type of a new device. OTA releases are matched against it. |
| `firmware` | 1 to 32 characters. The version the device runs. |
| `csr_pem` | A PKCS#10 request for an EC P-256 key, signed with ECDSA-SHA256, at most 4 KiB, in PEM. Its subject is ignored: the platform sets it. |

## Response

`200`:

```json
{
  "device_id": "9dc5e364-11e8-46ce-8cac-03388fe67dce",
  "cert_pem": "-----BEGIN CERTIFICATE-----\n...",
  "ca_pem": "-----BEGIN CERTIFICATE-----\n...",
  "mqtt_host": "mqtt.paqett.com",
  "mqtt_port": 8883,
  "topic_prefix": "devices/9dc5e364-11e8-46ce-8cac-03388fe67dce",
  "cert_not_after": "2031-11-19T12:41:00.000Z"
}
```

| Field | What it is |
| --- | --- |
| `device_id` | The platform's id for the device, a UUID. It is the certificate's common name, the MQTT username and client id, and the topic prefix. |
| `cert_pem` | The device's client certificate. Valid for 5 years, backdated 5 minutes to allow for clock skew. |
| `ca_pem` | The device CA. It signed the device's certificate and the broker's, so it is the only trust anchor the device needs for MQTT. |
| `mqtt_host`, `mqtt_port` | Where to connect: `mqtt.paqett.com`, `8883`. |
| `topic_prefix` | `devices/<device id>`, no trailing slash. Everything the device does is under it; build every topic from it. |
| `cert_not_after` | The certificate's expiry, ISO 8601, for devices that cannot parse a certificate (one held in a modem, say). |

Store the certificate and CA next to the key. The device needs all three to connect, and the response is the only time it gets them.

## Errors

Errors carry the API's usual JSON error body.

| Status | Meaning |
| --- | --- |
| `400` | A field is missing or invalid. A CSR problem reads `csr_pem: ...`: not P-256, not ECDSA-SHA256, a bad signature, too large. |
| `401` | No API key, or not a valid one. |
| `403` | The key lacks the `devices:provision` scope. |
| `409` | The device is enrolled with a different key (see below), or its `hardware_id` is registered to another project. |
| `429` | Too many requests. Back off and try again. |

A device should back off between attempts, and treat `401`, `403` and `409` as needing a person: retrying the same request will not change the answer.

## Asking again: renewal and lost certificates

Sending the same `hardware_id` again re-provisions the device. It keeps its `device_id` and gets a new certificate. Use it to renew before `cert_not_after`, or to recover a certificate the device lost. The old certificate stays valid until it is revoked.

## Re-provisioning is pinned to the device's key

While a device holds a certificate that is not revoked, a request for it must carry a CSR for the **same public key**. A different key gets `409`.

The pin is there because the provisioning key is in every device's flash. Without it, anyone who read the key out of one device could enrol their own key under another device's `hardware_id` and take it over.

A device that really lost its key, after a factory reset say, is re-keyed in two steps:

1. Revoke the device's certificates in the Paqett console. The broker disconnects it and refuses those certificates from then on.
2. The device enrols again with its new key. It keeps its `device_id`.

## Revocation

Revoking a device in the console revokes every live certificate it holds and disconnects it straight away. The broker checks every new connection against the platform, so a revoked certificate is refused for good, whatever restarts in between. Revocation is per certificate: a certificate issued after the revocation connects.

> **Note:** Revoking clears the key pin, which is what makes re-keying possible. It also means a revoked device that still holds the project's provisioning key can enrol again. To keep a device out for good, rotate the provisioning key as well: devices already enrolled keep connecting, and new devices ship with the new key.

If the broker cannot reach the platform to check a certificate, it refuses the connection (MQTT CONNACK `not authorised`) rather than letting it through. Devices retry with their back-off and get in once the check answers again; devices already connected are not affected.

## FAQ

### Can I send an RSA certificate signing request?

No. The CSR must be for an EC P-256 (secp256r1) key and signed with ECDSA-SHA256. Anything else is rejected with 400 and an error that starts with csr_pem.

### How long is a Paqett device certificate valid?

Five years from issue, backdated five minutes to allow for clock skew. The exact expiry is in cert_not_after. Renew by enrolling again with the same key before then: the device keeps its device id.

### Why does provisioning return 409 Conflict?

Either the device already holds a live certificate for a different public key, because re-provisioning is pinned to the original key, or its hardware_id is registered to another project. Revoke the device's certificates in the console to re-key it, or enrol it with the other project's key.

### Does the CSR subject matter?

No. The platform ignores the subject of the request and sets the certificate's common name to the device id itself.

### Is the provisioning response secret?

No. It contains the device's certificate and the CA certificate, both of which are public. The private key never appears in any request or response.

## Sources

- [RFC 2986: PKCS #10 Certification Request Syntax](https://www.rfc-editor.org/rfc/rfc2986): the CSR format a device sends to enrol.
- [RFC 5280: Internet X.509 Public Key Infrastructure Certificate and CRL Profile](https://www.rfc-editor.org/rfc/rfc5280): the X.509 certificate format the device and broker certificates follow.
- [Mbed TLS (GitHub)](https://github.com/Mbed-TLS/mbedtls): the TLS and X.509 library ESP-IDF uses for keys, CSRs and handshakes.
