---
title: "IoT device security glossary: X.509, CSR, mTLS, OTA and more"
nav: "Glossary"
description: "IoT device security glossary: short, standalone definitions of X.509, CSR, PEM, P-256, mTLS, CRL, OCSP, MQTT, NVS, OTA and the other terms these docs use."
tldr: "Short, standalone definitions of the terms used across device identity, MQTT and firmware update work: X.509 certificates and the PKI around them, CSRs and key formats, TLS and mutual TLS, revocation, provisioning models, MQTT concepts such as topics, QoS and last will, and ESP32 storage and OTA terms such as NVS, app slots and bootloader rollback."
order: 3
updated: 2026-11-19
kind: "glossary"
keywords: [iot device security glossary, what is an x509 certificate, what is a csr, mtls meaning, mqtt terms explained, ota firmware update terms]
about: [x509, pki, mtls, csr, tls, mqtt, ecc, ota, nvs]
---

This glossary defines the terms that come up when a device gets its own identity, talks MQTT over mutual TLS and takes firmware updates over the air. Each entry stands on its own and opens with a one-sentence definition. Where Paqett uses a term in a specific way, the entry says how and links to the reference page.

## A–F

### ACL (access control list)

An ACL is a set of rules on an MQTT broker that says which topics each client identity may publish and subscribe to. Authentication establishes who a client is; the ACL decides what it may do. On Paqett each device may use only topics under `devices/<id>/`.

See [MQTT topics](/devices/mqtt-topics).

### Bootloader rollback

Bootloader rollback is an ESP-IDF feature in which a newly installed app boots on trial and the bootloader returns to the previous app unless the new one marks itself valid. It is enabled with `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`; the app confirms itself with `esp_ota_mark_app_valid_cancel_rollback()`, and a reset before that call rolls it back.

See [OTA updates](/devices/ota).

### CA (certificate authority)

A CA is an entity that issues certificates by signing them with its own private key, vouching that a public key belongs to a named subject. Anyone who trusts the CA's certificate can verify every certificate it signed.

### Certificate chain

A certificate chain is the ordered list of certificates from an end-entity certificate up to a trust anchor, each one signed by the next. A verifier checks every signature, validity period and constraint along the chain, following the path validation rules in RFC 5280.

### Certificate pinning

Certificate pinning is a client policy that accepts only one specific certificate or public key for a server, instead of any certificate that chains to a trusted CA. It narrows trust, but every client must be updated with the new pin before the server's key changes.

### Certificate revocation

Certificate revocation is the act of declaring a certificate invalid before its expiry date, typically because its private key was lost or its device was retired. Verifiers learn about revocations through a CRL, through OCSP or by checking with the issuer on each connection.

See [What is MQTT mutual TLS?](/learn/mqtt-mutual-tls) for how a broker applies it.

### Cipher suite

A cipher suite is a named combination of cryptographic algorithms that a TLS connection uses. In TLS 1.3 it names only the record encryption and the hash, for example `TLS_AES_128_GCM_SHA256`, which every TLS 1.3 implementation must support; key exchange and signature algorithms are negotiated separately.

### Claim certificate

A claim certificate is a shared certificate and private key flashed into every device of a batch, which a device uses once to obtain its own unique certificate. AWS IoT fleet provisioning by claim works this way. Because every device carries the same claim key, reading it out of one device exposes the claim for the whole batch.

See [Claim certificates vs CSR](/learn/claim-certificates-vs-csr).

### Client ID

A client ID is the string an MQTT client sends in its CONNECT packet to identify its session to the broker. MQTT 5.0 requires brokers to accept client IDs of 1 to 23 bytes of letters and digits, and a new connection with a client ID already in use takes over that session. Paqett's broker sets the client ID from the device certificate's CN, whatever the device sends.

### CN (common name)

The CN is an attribute in a certificate's subject name that traditionally holds the name of the entity the certificate identifies. Many MQTT brokers use a client certificate's CN as the client's identity; on Paqett it is the device id.

### CRL (certificate revocation list)

A CRL is a list of revoked certificate serial numbers, signed and published by the CA that issued the certificates. RFC 5280 defines its format, and a verifier sees new revocations only when it fetches a fresh list.

### CSR (certificate signing request)

A CSR is a message in which a key holder asks a CA for a certificate: it carries the public key, a requested subject name and a signature made with the matching private key. The signature proves the requester holds the private key, and the private key itself is never sent. CSRs use the PKCS#10 format.

See [Provisioning API](/devices/provisioning).

### DER (Distinguished Encoding Rules)

DER is the binary encoding of ASN.1 structures in which every value has exactly one valid encoding. Certificates, CSRs and keys are defined in ASN.1 and are signed and stored as DER; PEM is DER wrapped in Base64 text.

### Device CA

A device CA is a certificate authority dedicated to signing the certificates of one platform's or one fleet's devices. Paqett's device CA signs every device's client certificate and the MQTT broker's server certificate, so it is the only trust anchor a device needs for MQTT.

### ECC (elliptic-curve cryptography)

ECC is public-key cryptography built on the arithmetic of points on an elliptic curve over a finite field. It reaches a given security strength with much smaller keys than RSA: NIST rates a 256-bit curve key at 128 bits of security, the same as a 3,072-bit RSA key.

### ECDSA (Elliptic Curve Digital Signature Algorithm)

ECDSA is the digital signature algorithm for elliptic-curve keys, standardised by NIST in FIPS 186. An ECDSA signature on P-256 is two 32-byte integers, r and s. Paqett devices sign their CSRs with ECDSA-SHA256 and sign their TLS handshakes with the same key.

### Flash encryption

Flash encryption is an ESP32 security feature that encrypts the contents of the chip's off-chip flash memory, controlled by eFuses, so a dumped flash image does not reveal firmware or data. ESP-IDF combines it with NVS encryption to protect key-value data such as a device's private key.

### Fleet provisioning

Fleet provisioning is the process of giving many devices their individual identities and credentials, usually at first boot rather than one by one at the factory. AWS IoT uses the term for its claim-based and trusted-user flows; Paqett devices do it by sending a CSR with a shared provisioning key.

## G–O

### Handshake (TLS handshake)

The TLS handshake is the opening exchange of a TLS connection, in which the peers agree on algorithms, derive shared keys and authenticate with certificates. In mutual TLS it includes the server's CertificateRequest and the client's Certificate and CertificateVerify messages.

### Hardware ID

A hardware ID is a stable identifier derived from the chip itself, which a device sends when it enrols so the platform recognises it across re-provisioning. On Paqett, `hardware_id` is 3 to 64 lower-case letters, digits and hyphens, and an ESP32-C6 uses `esp32c6-` followed by its base MAC address.

See [Provisioning API](/devices/provisioning).

### Image SHA-256

An image SHA-256 is the SHA-256 digest of a firmware image, used to confirm that the bytes a device downloaded are exactly the bytes that were released. A Paqett device receives the digest in its OTA offer over its authenticated MQTT session and boots nothing whose digest does not match.

### Intermediate CA

An intermediate CA is a certificate authority whose certificate is signed by a root CA or by another intermediate rather than by itself. It lets the root's private key stay offline while the intermediate signs day-to-day certificates, and a verifier needs its certificate in the chain to reach the root.

### JITP (just-in-time provisioning)

JITP is an AWS IoT Core feature that registers a device automatically the first time it connects with a certificate signed by a CA registered with AWS IoT. AWS IoT runs the provisioning template attached to that CA certificate, registering the device certificate as PENDING_ACTIVATION and then ACTIVE.

### Key pair

A key pair is a private key and its matching public key, generated together for an asymmetric algorithm such as ECDSA or RSA. Whatever the private key signs, the public key verifies.

### Key pinning (re-provisioning)

Key pinning, as Paqett uses it, ties a device's re-provisioning to the public key it enrolled with: while the device holds an unrevoked certificate, a new CSR must carry the same public key or the platform answers `409`. It stops anyone who extracted the shared provisioning key from enrolling their own key under an existing device's id. Revoking the device's certificates clears the pin.

See [Provisioning API](/devices/provisioning).

### Last will (will message)

A last will is a message a client registers in its CONNECT packet, which the broker publishes on the client's behalf if the connection ends without a clean DISCONNECT. Paqett devices register a retained `{"online":false}` on `devices/<id>/status` as their will.

### MQTT

MQTT is a lightweight publish-subscribe messaging protocol, standardised by OASIS, in which clients exchange messages through a broker using named topics. It runs over TCP, on port 1883 in plain text or port 8883 over TLS.

### MQTT broker

An MQTT broker is the server that accepts client connections, authenticates them, and routes each published message to the clients subscribed to matching topics. It also stores retained messages and publishes last wills.

### mTLS (mutual TLS)

mTLS is TLS in which both the server and the client authenticate with certificates, rather than the server alone. The client proves possession of its private key by signing the handshake, so the server knows which client is connected before any application data flows.

See [What is MQTT mutual TLS?](/learn/mqtt-mutual-tls).

### NVS (non-volatile storage)

NVS is ESP-IDF's library for storing key-value pairs in a flash partition, used for configuration and credentials that must survive a reboot. Without NVS encryption, anyone with physical access to the flash chip can read, change or add entries, so a private key kept in NVS needs NVS encryption and flash encryption in production.

### OCSP (Online Certificate Status Protocol)

OCSP is a protocol, defined in RFC 6960, for asking a CA's responder whether one specific certificate is good, revoked or unknown. It gives fresher answers than a CRL, but the responder must be reachable whenever a check runs.

### OTA (over-the-air update)

An OTA update is a firmware update delivered to a device over its network connection instead of a cable. A safe OTA design writes the new image to a spare slot, verifies it, and keeps the previous image bootable until the new one proves it works.

See [ESP32 OTA updates over MQTT](/guides/esp32-ota-updates-over-mqtt).

### OTA partition (app slot)

An OTA partition, or app slot, is one of the flash partitions an ESP32 can boot an application from. ESP-IDF OTA needs at least two app slots, `ota_0` and `ota_1`, plus an OTA data partition, and writes each new image to the slot that is not currently selected for booting.

## P–Z

### P-256 (secp256r1, prime256v1)

P-256 is the NIST elliptic curve over a 256-bit prime field, also called secp256r1 by SECG and prime256v1 by RFC 3279 and OpenSSL. It gives 128-bit security, and TLS 1.3 requires every implementation to support ECDSA signatures and key exchange on it. Paqett device keys must be P-256.

### PEM

PEM is a text encoding that wraps Base64-encoded DER between `-----BEGIN` and `-----END` lines carrying a label such as `CERTIFICATE` or `PRIVATE KEY`. RFC 7468 defines the labels used for certificates, CSRs and private keys.

### PKCS#10

PKCS#10 is the standard format for certificate signing requests, published as RFC 2986. A PKCS#10 request holds a subject name, a SubjectPublicKeyInfo and optional attributes, signed with the requester's private key.

### Port 8883

Port 8883 is the TCP port IANA registers for MQTT over TLS, under the service name `secure-mqtt`. Plain MQTT uses port 1883, and whether a broker also requires client certificates on 8883 is a setting of that broker.

### Private key

A private key is the secret half of a key pair, used to create signatures or to decrypt. Whoever holds a device's private key can act as that device, so it should be generated on the device and never leave it.

### Provisioning key

A provisioning key is a Paqett project API key, carrying only the `devices:provision` scope, that ships in a fleet's firmware so devices can enrol themselves. It can enrol new devices into its project and do nothing else; revoking it stops enrolment but not devices already enrolled.

See [Provisioning API](/devices/provisioning).

### Public key

A public key is the shareable half of a key pair, used to verify signatures made with the private key or to encrypt data for its holder. A certificate binds a public key to a name.

### QoS (quality of service)

QoS is the MQTT delivery guarantee attached to each message: 0 is at most once, 1 is at least once and 2 is exactly once. Higher levels add acknowledgement packets, and Paqett devices use QoS 1 on every topic.

### Retained message

A retained message is the last message published with the RETAIN flag on a topic, which the broker stores and sends straight away to every new subscriber of that topic. Publishing an empty retained payload to the topic removes it.

### Root CA

A root CA is a certificate authority at the top of a chain, whose certificate is self-signed and trusted because it was installed in advance rather than because anything signed it. A root CA's certificate usually serves as the trust anchor.

### RSA

RSA is a public-key algorithm whose security rests on the difficulty of factoring the product of two large primes, used for signatures and encryption. An RSA-2048 key gives 112-bit security and makes 256-byte signatures, against 128 bits and 64 bytes for ECDSA on P-256.

### SAN (subject alternative name)

A SAN is an X.509 certificate extension that lists the identities a certificate covers, such as DNS names, IP addresses or URIs. TLS clients check a server's hostname against these entries, which is why a device must connect to a broker by the name in its certificate, not by IP address.

### Secure element

A secure element is a separate tamper-resistant chip that generates and stores private keys and performs signatures internally, so the keys cannot be read out even by someone who dumps the main processor's flash. The host asks it to sign the TLS handshake instead of holding the key itself.

### Signed URL

A signed URL is a download link that carries its own expiry time and a cryptographic signature over its contents, so a server can authorise the request without an API key. Paqett's firmware download links are signed with HMAC-SHA256 and valid for one hour.

See [OTA updates](/devices/ota).

### SPKI (SubjectPublicKeyInfo)

SPKI is the X.509 structure that holds a public key together with its algorithm identifier, used in certificates and CSRs alike. A SHA-256 hash of the SPKI fingerprints a key independently of any certificate, and Paqett compares these hashes to pin re-provisioning to a device's key.

### TLS (Transport Layer Security)

TLS is the IETF protocol that gives a network connection confidentiality, integrity and authentication, standardised as TLS 1.2 in RFC 5246 and TLS 1.3 in RFC 8446. The server is always authenticated; the client is authenticated only in mutual TLS.

### Topic

A topic is the UTF-8 string, divided into levels by slashes, that an MQTT message is published to and that subscriptions match against. A subscription can use `+` to match one level and `#` to match all remaining levels, as in `devices/<id>/cmd/#`.

### Trust anchor

A trust anchor is the certificate or public key a verifier trusts by configuration, at which every certificate chain it accepts must end. A Paqett device's trust anchor for MQTT is the device CA from its provisioning response, not the public root store.

### X.509 certificate

An X.509 certificate is a signed data structure that binds a public key to a subject name for a validity period, issued by a certificate authority. RFC 5280 profiles it for the Internet, and TLS uses it to authenticate servers and, in mutual TLS, clients.

## Related

- [What is MQTT mutual TLS?](/learn/mqtt-mutual-tls)
- [Claim certificates vs CSR provisioning](/learn/claim-certificates-vs-csr)
- [How IP devices connect to Paqett](/devices/overview)
- [ESP32 MQTT over mutual TLS with an X.509 client certificate](/guides/esp32-mqtt-mutual-tls-x509)

## Sources

- [RFC 5280: Internet X.509 PKI Certificate and CRL Profile](https://www.rfc-editor.org/rfc/rfc5280): X.509 certificates, SAN, SPKI, CRLs, path validation
- [RFC 2986: PKCS #10 Certification Request Syntax](https://www.rfc-editor.org/rfc/rfc2986): the CSR format
- [RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446): handshake, cipher suites, mandatory P-256 support
- [MQTT Version 5.0, OASIS Standard](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html): client ID, QoS, retained messages, will messages, topic wildcards, ports
- [ESP-IDF: Over The Air Updates (OTA)](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html): app slots, OTA data partition, bootloader rollback
- [ESP-IDF: Non-Volatile Storage Library](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/storage/nvs_flash.html): NVS key-value storage and NVS encryption
