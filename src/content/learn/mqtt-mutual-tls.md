---
title: "What is MQTT mutual TLS (mTLS)? Device certificates explained"
nav: "MQTT mutual TLS explained"
description: "MQTT mutual TLS explained: how the handshake proves a device holds its key, how the broker maps a certificate to an identity, and why it beats passwords."
tldr: "MQTT mutual TLS is MQTT over TLS, normally on port 8883, where the device also presents an X.509 client certificate and signs the handshake with its private key. The broker checks the certificate against its CA, takes the device's identity from it and applies per-device topic permissions. No password or shared secret crosses the wire."
order: 1
updated: 2026-11-19
keywords: [mqtt mutual tls, mqtt mtls, mqtt client certificate authentication, mqtt tls port 8883, mqtt username password vs certificate, how does mutual tls work, mqtt x509 authentication]
about: [mtls, mqtt, x509, tls, pki, ecc, mbedtls, esp32]
---

MQTT mutual TLS (mTLS) is MQTT carried over a TLS connection in which both ends authenticate with X.509 certificates. The broker proves its identity to the device, as in any TLS connection, and the device proves its identity to the broker by presenting a client certificate and signing the handshake with the matching private key. The broker then treats the certificate as the device's login: no username or password is needed.

## What does TLS prove, and what does mutual TLS add?

Plain TLS authenticates the server only; mutual TLS authenticates the client as well. RFC 8446 states it directly: "The server side of the channel is always authenticated; the client side is optionally authenticated."

With ordinary MQTT over TLS, the device checks that the broker's certificate chains to a CA it trusts and matches the hostname it dialled. The broker learns nothing about the device from the handshake, so the device has to log in afterwards, usually with the username and password fields of the MQTT CONNECT packet.

Mutual TLS turns on the optional half. The broker asks for a certificate, the device sends one, and the device proves it holds the private key for it. By the time the first MQTT byte flows, the broker knows which device it is talking to. The MQTT 5.0 specification names this option in its security chapter: "TLS Certificates sent from the Client can be used by the Server to authenticate the Client."

## How does the mutual TLS handshake work?

The handshake adds three messages to ordinary TLS: the server's CertificateRequest, and the client's Certificate and CertificateVerify. In TLS 1.3 (RFC 8446) the full sequence is:

1. **ClientHello.** The device offers its cipher suites, signature algorithms and a key share.
2. **ServerHello.** The broker picks the parameters and sends its own key share. Both sides now derive handshake keys, and every message after this point is encrypted.
3. **EncryptedExtensions and CertificateRequest.** The broker asks the device for a certificate and lists the signature algorithms it accepts.
4. **Server Certificate, CertificateVerify and Finished.** The broker sends its certificate chain and signs the handshake transcript with its private key.
5. **The device checks the broker.** It verifies the broker's chain against its trust anchor and checks the hostname.
6. **Client Certificate, CertificateVerify and Finished.** The device sends its own certificate chain, then a signature over the whole handshake made with its private key.
7. **The broker checks the device.** It verifies the device's chain against its CA and checks the CertificateVerify signature with the public key in the device's certificate. A broker that requires client certificates aborts the handshake at this point if either check fails or no certificate arrived.

Only then does the device send MQTT CONNECT, inside the encrypted channel.

### Why is CertificateVerify the step that matters?

The certificate itself is public: anyone who has seen it can send a copy. CertificateVerify is what proves possession of the private key. It is a signature over the transcript of this particular handshake, which includes fresh random values from both sides, so it cannot be replayed into another connection. The private key never leaves the device; only a signature made with it does.

### What changes between TLS 1.2 and TLS 1.3?

The same three messages exist in both versions, but TLS 1.3 encrypts them. RFC 8446 lists the change: "All handshake messages after the ServerHello are now encrypted."

| | TLS 1.2 (RFC 5246) | TLS 1.3 (RFC 8446) |
| --- | --- | --- |
| Where the server asks for a certificate | CertificateRequest, after ServerKeyExchange and before ServerHelloDone | CertificateRequest, right after EncryptedExtensions |
| Client messages | Certificate, ClientKeyExchange, CertificateVerify, then ChangeCipherSpec and Finished | Certificate, CertificateVerify, Finished |
| Is the client certificate encrypted on the wire? | No: it travels before ChangeCipherSpec | Yes |
| What CertificateVerify signs | All handshake messages so far | A hash of the handshake transcript so far |

The practical difference for devices is privacy, not authentication. Over TLS 1.2, anyone on the network path can read the device's certificate, including the identity in its subject. That is not a credential, but it does let an observer tell devices apart. Check which version your build speaks: the prebuilt ESP-IDF libraries in Arduino-ESP32 3.1.3 for the ESP32-C6 have TLS 1.2 enabled and TLS 1.3 disabled.

## How does an MQTT broker turn a certificate into an identity?

The broker reads a field from the verified certificate, usually the subject's common name (CN), and uses it as the client's identity for the rest of the session. Access rules then apply per identity.

The MQTT specification leaves the mapping to the broker, so it is a configuration choice. The safest mapping ignores whatever the client puts in the CONNECT packet and uses only the certificate. On Paqett, the CN of every device certificate is the device's id, a UUID. The broker sets both the MQTT username and the client id from that CN, whatever the device sends, and its access control list lets each identity publish and subscribe under `devices/<id>/#` and nowhere else. See [MQTT topics](/devices/mqtt-topics) for the topic map.

Two consequences follow:

- **A device cannot speak for another device.** Its topics are fixed by a certificate signed by the platform's CA, not by a string it chooses.
- **One certificate is one session.** MQTT 5.0 requires a broker to disconnect an existing client when a new connection arrives with the same client id, with reason code 0x8E (Session taken over). Two devices sharing a certificate would knock each other off.

Paqett's broker also checks every CONNECT with the platform before it accepts it. The certificate must be one the platform issued, to that very device id, not revoked and inside its validity period. See [Provisioning API](/devices/provisioning) for how certificates are issued and revoked.

## What are ports 8883 and 1883?

Port 8883 is the IANA-registered port for MQTT over TLS, and 1883 is the port for plain MQTT. The [IANA service name registry](https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml?search=8883) lists them as `secure-mqtt` and `mqtt`, both registered to OASIS, and the MQTT 5.0 specification repeats the assignment.

Mutual TLS is not a separate port. It is a setting on a TLS listener: the broker either requires a client certificate on that port or it does not. Paqett devices connect to `mqtt.paqett.com:8883`, which requires one. A connection on 1883 carries the CONNECT packet, including any password, in clear text.

## Certificates vs username and password vs pre-shared keys

A client certificate is the only one of the three in which the server never holds anything that would let someone else connect as the device. Passwords and pre-shared keys are shared secrets: the broker, or its database, holds something equivalent to the device's credential.

| | Username and password over TLS | TLS pre-shared key (PSK) | X.509 client certificate |
| --- | --- | --- | --- |
| What the device proves | It knows a secret, sent inside CONNECT | It holds the same symmetric key as the server | It holds the private key for a certificate the CA signed |
| What crosses the wire | The password, inside the TLS tunnel; the broker sees it in full | Nothing secret; the key is proved, not sent | The certificate (public) and a signature |
| What leaks from a broker breach | Password hashes, or the passwords themselves | Every device's key, in usable form | Certificates and fingerprints, which are public |
| What leaks from one device's flash | A password that works from anywhere | A key that works from anywhere | That device's private key only |
| Revocation | Delete or change the account | Delete the PSK identity | Revoke the certificate: CRL, OCSP or a broker-side check |
| Rotation | Deliver a new password to the device | Deliver a new key to both ends | Device sends a new CSR; the key can stay on the device |
| Cost on a microcontroller | Lowest: server authentication only | Low: PSK-only mode needs no public-key operations | One extra signature per handshake and a chain to verify |

PSK-only mode has a further drawback: RFC 8446 defines it with no key share, so the session has no forward secrecy. PSK with ephemeral Diffie-Hellman restores that at the cost of the public-key operation PSK was meant to avoid.

The certificate column is also the only one where the private key can be made on the device and never copied. The device sends a certificate signing request (CSR), which carries only its public key, and the CA signs it. Paqett's devices enrol this way; see [Claim certificates vs CSR](/learn/claim-certificates-vs-csr) for how it compares with flashing a shared claim certificate.

## How long should a device certificate last, and how is it revoked?

Lifetime and revocation trade against each other. A long-lived certificate needs revocation that works; a short-lived one needs renewal that works on every device, including ones that are asleep or offline when it falls due. Paqett issues device certificates valid for 5 years, backdated 5 minutes for clock skew, and a device renews by enrolling again with the same key.

There are three common ways for a broker to refuse a revoked certificate:

- **Certificate revocation list (CRL).** The CA publishes a signed list of revoked serial numbers (RFC 5280, section 5), and the broker loads it. Revocation takes effect when the broker next loads a fresh list, and the list grows with every revocation.
- **Online Certificate Status Protocol (OCSP).** The broker asks the CA's responder about each certificate it sees ([RFC 6960](https://www.rfc-editor.org/rfc/rfc6960)). The answer is current, but every connection now depends on the responder being reachable.
- **A broker-side check on every connection.** The broker asks the issuing platform whether this certificate is still good. This is what Paqett does: on each CONNECT the broker hands the certificate to the platform, which answers yes only for a certificate it issued to that device id, not revoked and within its validity period.

Paqett's check fails closed. If the platform does not answer, the broker refuses the CONNECT with "not authorised" (MQTT 3.1.1 return code 5, MQTT 5.0 reason code 0x87) rather than letting an unchecked certificate in. Devices retry with back-off and connect once the check answers again; sessions already open are not touched. Revoking a device also disconnects it at once, so revocation does not wait for the next reconnect.

The MQTT 5.0 specification's security notes recommend revoking lost or compromised certificates with CRLs or OCSP. A per-connection check covers the same ground and keeps revocations in the platform's own records, so they survive a broker restart.

## What does an ESP32 need for MQTT mutual TLS?

An ESP32 needs a TLS stack with ECDSA, a few kilobytes of non-volatile storage for its key, certificate and CA, and enough heap for one handshake. ESP-IDF provides all three: Mbed TLS for TLS and X.509, NVS for storage, and esp-mqtt to put MQTT on top.

- **Mbed TLS.** ESP-IDF ships a fork of Mbed TLS with patches for the chip's hardware bignum (MPI) and ECC accelerators. The Arduino-ESP32 3.1.3 build for the ESP32-C6 has both `CONFIG_MBEDTLS_HARDWARE_MPI` and `CONFIG_MBEDTLS_HARDWARE_ECC` enabled.
- **Heap.** Espressif measures about 42,196 bytes of heap for its `https_request` example with default settings, and about 22,013 bytes with dynamic TX/RX buffers enabled (`CONFIG_MBEDTLS_DYNAMIC_BUFFER` and related options). That example validates the server only; a client certificate adds the device's own key and certificate on top.
- **Storage.** Three PEM strings: the private key, the device certificate and the CA. Keep them in NVS, never in the firmware image, and enable NVS encryption with flash encryption for production.
- **Entropy.** The key must come from the hardware random number generator, which produces true entropy only while the radio is running. Start Wi-Fi before generating a key.

### Should an ESP32 use EC P-256 or RSA-2048?

Use EC P-256. It gives more security per byte and per operation, and Paqett accepts only P-256 CSRs signed with ECDSA-SHA256.

| | EC P-256 (secp256r1) | RSA-2048 |
| --- | --- | --- |
| Security strength (NIST SP 800-57) | 128 bits | 112 bits |
| Public key | 65-byte uncompressed point (RFC 5480) | 256-byte modulus plus exponent |
| Private key, measured with OpenSSL | 121 bytes DER, 227 bytes PEM | 1,190 bytes DER, 1,704 bytes PEM |
| Signature | 64 bytes as r and s; at most 72 bytes in DER | 256 bytes, the modulus length (RFC 8017) |
| Self-signed certificate, same subject, measured | 407 bytes DER | 802 bytes DER |
| TLS 1.3 status | `ecdsa_secp256r1_sha256` is mandatory to support | `rsa_pkcs1_sha256` is mandatory for certificates |

Key generation also favours P-256. A P-256 private key is one random 32-byte scalar and one point multiplication; an RSA key means searching for two large primes on the device. For the full ESP32 code, from key generation to a connected esp-mqtt client, follow [ESP32 MQTT over mutual TLS with an X.509 client certificate](/guides/esp32-mqtt-mutual-tls-x509).

## FAQ

### Is MQTT over TLS the same as MQTT mutual TLS?

No. MQTT over TLS encrypts the connection and authenticates the broker to the device. Mutual TLS adds the reverse direction: the device presents a client certificate and proves it holds the private key, so the broker authenticates the device during the handshake.

### Do I need a username and password with mutual TLS?

Not if the broker maps the certificate to an identity. The certificate replaces the password. On Paqett the broker sets the username and client id from the certificate's common name, so a device sends no username or password at all.

### Is a client certificate secret?

No. The certificate holds only the public key and the CA's signature, and over TLS 1.2 it crosses the network unencrypted. The secret is the private key, which stays on the device and is used only to sign the handshake.

### Can two devices share one client certificate?

They should not. The broker sees both as the same identity, and MQTT requires it to disconnect the first connection when the second arrives with the same client id. Sharing also means one leaked key compromises both devices and one revocation cuts off both.

### What happens if the broker cannot check whether a certificate is revoked?

That depends on the broker's policy. Paqett's broker fails closed: it refuses new connections with "not authorised" until the check answers again, and devices retry with back-off. Connections already open stay up.

### Does mutual TLS work with both MQTT 3.1.1 and MQTT 5?

Yes. TLS sits below MQTT, so the handshake is identical whichever MQTT version the device speaks afterwards. Only the CONNACK codes differ: a refusal is return code 5 in MQTT 3.1.1 and reason code 0x87 in MQTT 5.0.

## Related

- [ESP32 MQTT over mutual TLS with an X.509 client certificate](/guides/esp32-mqtt-mutual-tls-x509)
- [Claim certificates vs CSR provisioning](/learn/claim-certificates-vs-csr)
- [Provisioning API](/devices/provisioning)
- [IoT device security glossary](/learn/glossary)

## Sources

- [RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446): handshake flow, CertificateRequest, CertificateVerify, encrypted handshake, PSK modes, mandatory algorithms
- [RFC 5246: The TLS Protocol Version 1.2](https://www.rfc-editor.org/rfc/rfc5246): the TLS 1.2 message flow with client certificates
- [MQTT Version 5.0, OASIS Standard](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html): ports 8883 and 1883, client authentication by TLS certificate, session takeover, reason code 0x87
- [RFC 5280: Internet X.509 PKI Certificate and CRL Profile](https://www.rfc-editor.org/rfc/rfc5280): certificate and CRL structure
- [ESP-IDF: Mbed TLS](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/protocols/mbedtls.html): ESP-IDF's Mbed TLS fork, hardware acceleration and heap figures
- [NIST SP 800-57 Part 1 Rev. 5](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final): comparable security strengths of RSA and ECC keys
