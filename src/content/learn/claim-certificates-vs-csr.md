---
title: "IoT device certificate provisioning: claim certs vs CSRs"
nav: "Claim certificates vs CSRs"
description: "IoT device certificate provisioning compared: shared certs, factory injection, AWS fleet provisioning by claim, JITP/JITR and device-generated CSRs."
tldr: "Give every device its own X.509 certificate for a private key that never leaves it. A device-generated key plus a CSR does that with no factory step: AWS CreateCertificateFromCsr and Paqett's enrolment API both work this way. Shared certificates and server-generated keys (CreateKeysAndCertificate) expose far more when one device is opened up."
order: 2
updated: 2026-11-19
keywords: [iot device certificate provisioning, aws iot fleet provisioning by claim, claim certificate vs csr, just in time provisioning vs fleet provisioning, how to provision x509 certificates to iot devices, CreateKeysAndCertificate vs CreateCertificateFromCsr, factory certificate injection]
about: [x509, pki, csr, mtls, ecc, aws-iot, mqtt]
---

IoT device certificate provisioning is how each device ends up holding a private key and an X.509 certificate that a broker trusts. The approaches differ in two things that matter: where the private key is generated, and what secret every device carries before it has its own identity. The strongest arrangement has the device generate its own key, send only a certificate signing request (CSR), and carry nothing that lets an attacker impersonate another device.

## What are the options, in plain terms?

There are five common ways to get certificates onto a fleet, and one anti-pattern. For a CTO the short version is this: a shared certificate is one leak away from losing the whole fleet; per-device certificates fix that, and the remaining choice is whether you mint them in the factory or let each device enrol itself on first boot.

1. **One shared certificate in every device.** Simple, and unsafe at any scale.
2. **Per-device certificates injected at the factory.** Each unit leaves the line with its own key and certificate, often in a secure element.
3. **AWS IoT fleet provisioning by claim.** Every device ships with the same claim certificate and swaps it for its own certificate on first connection.
4. **AWS IoT just-in-time provisioning or registration (JITP, JITR).** You sign device certificates with your own CA, register that CA with AWS, and AWS registers each certificate the first time it is seen.
5. **AWS IoT fleet provisioning by trusted user.** An installer's app fetches a five-minute claim certificate and hands it to the device.
6. **Device-generated key and CSR, enrolled over HTTPS with a scoped API key.** The model Paqett uses: the device makes a P-256 key, posts a CSR, and gets its certificate back.

## How do the approaches compare?

The table compares them on the questions that decide security and cost. "Shared secret" means a credential that is identical in every unit and can be read out of any one of them.

| | Shared certificate | Factory injection | AWS by claim: CreateKeysAndCertificate | AWS by claim: CreateCertificateFromCsr | AWS JITP / JITR | AWS by trusted user | Device CSR over HTTPS (Paqett) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Who generates the private key | You, once | The device or secure element, or your factory tooling | AWS IoT | The device | The device or your factory tooling | AWS IoT or the device, depending on which call the device makes | The device |
| Does the key cross the network | Copied into every image | Only if factory tooling generates it | Yes: returned in the `privateKey` field over MQTT | No: only the CSR is sent | Only if factory tooling generates it | With CreateKeysAndCertificate, yes | No: only the CSR is sent |
| Shared secret in every device | The certificate itself | None | Claim certificate and key | Claim certificate and key | None | None: each claim is temporary and per device | Provisioning API key with only the `devices:provision` scope |
| What extracting it gets an attacker | Full access as every device | One device's identity | New devices registered under your template | New devices registered under your template | One device's identity | A claim that expired after five minutes | New devices enrolled into the project; existing devices cannot be taken over, because re-enrolment is pinned to each device's key |
| Manufacturing step | Flash one file | Per-unit key and certificate step, plus CA operations | Embed the claim certificate | Embed the claim certificate | Per-unit certificate signed by your CA | None for credentials; an installer app at deployment | None: same firmware and key in every unit |
| Revocation | All or nothing | Per certificate, in whatever broker trusts your CA | Per certificate; deactivating the claim stops new registrations | Per certificate; deactivating the claim stops new registrations | Per certificate | Per certificate | Per certificate, enforced by the broker on every connection |
| Vendor lock-in | Depends on broker | Low: your CA, any broker | AWS: Amazon-signed certificates, `$aws/` MQTT topics | AWS: Amazon-signed certificates, `$aws/` MQTT topics | Low for certificates (your CA); provisioning logic in AWS | AWS | Certificates signed by Paqett's CA; device side is a standard CSR and one HTTPS call |
| Works with a modem that generates keys internally | No | Yes, if the factory step reads the modem's CSR | No: the key comes from AWS | Yes | Yes, if the factory step reads the modem's CSR | Only with CreateCertificateFromCsr | Yes |

The last row matters for cellular devices. A Nordic nRF91 modem can generate its key pair internally with `AT%KEYGEN` and hand back a CSR, so the private key never exists outside the modem. Any scheme that generates the key on a server cannot use that, because it has to write a server-made key into the modem.

## Why does one shared certificate fail?

A certificate shared by every device gives every device the same identity, so a key extracted from one unit is a key for all of them. Firmware images are routinely dumped from flash, and a certificate in the image is a certificate in the attacker's hands.

The consequences follow directly. The broker cannot tell devices apart, so it cannot restrict each one to its own topics. Revoking the certificate disconnects the entire fleet at once, and replacing it means updating every device, which an attacker with the same certificate can watch happen. A shared certificate is acceptable on a bench with three development boards and nowhere else.

## What does factory certificate injection involve?

Factory injection gives each unit its own key and certificate before it ships, so no shared secret exists in the field. The cost moves to manufacturing: a station on the line has to generate or read a key, get a certificate signed, and write it to the unit.

The secure version generates the key inside the device or a secure element and has the station read only the CSR or public key; the station then signs it with a CA you control. The weaker version generates keys on the station and copies them in, which puts every private key through your factory network. Either way you are running a CA, protecting its signing key, and keeping the station and the CA in sync across contract manufacturers.

The payoff is portability. Certificates signed by your own CA work with any broker that trusts that CA. AWS IoT accepts them through JITP or JITR, through bulk registration, or one at a time.

## How does AWS IoT fleet provisioning by claim work?

Fleet provisioning by claim embeds one claim certificate and key in every device. On first connection the device uses it to obtain its own certificate, then calls RegisterThing to create its AWS resources, then reconnects with the new certificate. AWS describes the claim certificate as "shared by other devices in the fleet".

### What do you set up before shipping?

You create a provisioning template, register the claim certificates with an IoT policy that only allows the provisioning topics (`$aws/certificates/create/*` and `$aws/provisioning-templates/<templateName>/provision/*`), and give AWS IoT a provisioning role with the `AWSIoTThingsRegistration` managed policy. AWS's own guidance is that claim private keys "should be secured at all times, including on the device", and that you should monitor for misuse and turn off the claim certificate if you detect it.

### CreateKeysAndCertificate vs CreateCertificateFromCsr: what is the difference?

Both are MQTT calls the device makes while connected with the claim certificate. Both return a certificate signed by the Amazon Root CA in `PENDING_ACTIVATION` state and a `certificateOwnershipToken`.

- **CreateKeysAndCertificate** takes an empty payload on `$aws/certificates/create/json`. AWS IoT generates the key pair and returns `certificatePem` and `privateKey` to the device. The private key exists in AWS first and crosses the network.
- **CreateCertificateFromCsr** takes a PEM CSR on `$aws/certificates/create-from-csr/json`. AWS returns only `certificatePem`. AWS's guide describes it as generating a certificate "from a certificate signing request that keeps its private key secure": the device generates the key and keeps it.

If you use fleet provisioning, use CreateCertificateFromCsr. It costs the device one key generation and one CSR, which any ESP32 or nRF91 can do, and it is the only variant that works with keys held in a modem or secure element.

### What do RegisterThing and the provisioning template do?

RegisterThing exchanges the ownership token for a provisioned thing. The device publishes the token and optional parameters to `$aws/provisioning-templates/<templateName>/provision/json`; the template creates the thing, attaches a policy and sets the certificate to `ACTIVE` or `INACTIVE`. The token expires after one hour. If RegisterThing has not completed by then, AWS deletes the unactivated certificate and the device has to request a new one.

### What are pre-provisioning hooks for?

A pre-provisioning hook is a Lambda function AWS IoT calls on every RegisterThing request to approve or refuse it. It receives the claim certificate id, the new certificate, the client id and the device's parameters, and must return `allowProvisioning: true` within 5 seconds or the request fails with `ACCESS_DENIED`. AWS recommends them for controlling which and how many devices your account onboards.

This is the main defence against a stolen claim certificate. Without a hook, anyone holding the claim can register new things. With a hook that checks serial numbers against your manufacturing list, the claim alone is not enough. Deactivating a compromised claim certificate stops future registrations; AWS notes it does not block devices already provisioned.

## How do JITP and JITR work?

Just-in-time provisioning and registration apply to devices that already carry a certificate signed by your own CA. You register that CA with AWS IoT and enable automatic registration; the first time a device connects with a certificate from it, AWS registers that certificate in `PENDING_ACTIVATION` state.

The two differ in what happens next:

- **JITP** attaches a provisioning template (type `JITP`) to the CA. AWS fills the template from the certificate's subject fields (common name, serial number, country and so on), creates the thing and policy, and sets the certificate to `ACTIVE`. Provisioning fails if the certificate lacks a subject field the template declares.
- **JITR** publishes an event to `$aws/events/certificates/registered/<caCertificateId>` and leaves the rest to you. AWS recommends a rule and Lambda function that checks the certificate against a revocation list, activates it and attaches a policy.

In both cases the device does not need to send the CA certificate in the handshake, but it must send the SNI extension. JITP and JITR involve no shared secret, and the certificates come from your CA rather than Amazon's. They do not remove the manufacturing step: something still has to put a CA-signed certificate on each unit before it ships.

## What is fleet provisioning by trusted user?

Provisioning by trusted user removes the embedded claim. An installer or end user signs in to your app, which calls `CreateProvisioningClaim` and receives a temporary claim certificate valid for five minutes. The app passes it to the device along with configuration such as Wi-Fi credentials, and the device then calls CreateKeysAndCertificate or CreateCertificateFromCsr and RegisterThing within that window.

AWS recommends it when devices cannot be given unique certificates before delivery but someone installs them with an app. It fits consumer devices with a phone-based setup flow. It does not fit devices that are deployed without a person present, such as sensors posted to a site and switched on by a non-technical contact.

## How does device-generated CSR enrolment over HTTPS work?

The device generates an EC P-256 key, builds a CSR signed with ECDSA-SHA256, and posts it over HTTPS with a project API key that can do nothing except enrol. The platform returns the certificate, the CA and the broker address. This is how Paqett devices enrol; the request and response are documented in the [Provisioning API](/devices/provisioning).

```text
device                                            api.paqett.com
  | generate EC P-256 key (stays on the device)       |
  | build CSR (public key + signature)                |
  |-- POST /v1/devices/provision -------------------->|
  |   Authorization: Bearer pq_live_...               | key scope: devices:provision only
  |   hardware_id, model, firmware, csr_pem           | CSR checked, certificate signed
  |<-- device_id, cert_pem, ca_pem, mqtt_host, -------|
  |    mqtt_port, topic_prefix, cert_not_after        |
```

Several properties follow from the design:

- **The private key never crosses the network.** The CSR carries only the public key. A leak of the platform's database, or of a provisioning response, gives nobody a way to connect as a device.
- **The shared secret can only enrol.** Every device carries the same provisioning key. An attacker who reads it out of one unit can enrol new devices into that project and do nothing else: no reading data, no sending commands.
- **Re-enrolment is pinned to the device's key.** While a device holds an unrevoked certificate, a new request for its `hardware_id` must carry a CSR for the same public key, or it gets `409`. So the provisioning key cannot be used to take over an existing device.
- **Revocation is per certificate and enforced by the broker.** Revoking a device in the console disconnects it and the broker refuses those certificates on every new connection. If the broker cannot reach the platform to check, it refuses the connection: it fails closed.
- **No manufacturing step.** Every unit ships with the same firmware and key; each turns that into its own identity on first boot.

The trade-off is the same one as an AWS claim certificate used with CreateCertificateFromCsr: a fleet-wide credential exists, and its power is limited by scope rather than by being unique. Rotating the provisioning key stops further enrolment with the old one, while enrolled devices keep connecting. The [ESP32 guide](/guides/esp32-mqtt-mutual-tls-x509) walks through the device side.

## Which should I use?

Use per-device keys generated on the device in every case, and pick the delivery mechanism by where your devices are made and who switches them on.

| Situation | Approach |
| --- | --- |
| Prototype on a desk, a handful of boards | Device CSR enrolment, or factory-style certificates made by hand; never a shared certificate past the bench |
| You control the production line and already run a CA | Factory injection, with keys generated in the device or secure element; JITP or JITR if the broker is AWS IoT |
| Devices on AWS IoT, no per-unit step on the line | Fleet provisioning by claim with CreateCertificateFromCsr and a pre-provisioning hook checking serial numbers |
| Consumer devices set up through a phone app, on AWS IoT | Fleet provisioning by trusted user |
| Cellular devices whose modem generates the key | Any CSR-based path: CreateCertificateFromCsr, factory injection reading the modem's CSR, or device CSR enrolment |
| Devices installed by non-specialists with no app, same firmware for every unit | Device-generated CSR over HTTPS with an enrol-only key, as on Paqett |
| Anything | Avoid CreateKeysAndCertificate unless the device genuinely cannot generate a key |

## FAQ

### What is a claim certificate in AWS IoT?

A claim certificate is a special-purpose X.509 certificate, shared across a fleet, that only has permission to request a device certificate and register a thing. Devices connect with it once, obtain their own certificate through CreateKeysAndCertificate or CreateCertificateFromCsr, call RegisterThing, and reconnect with the new certificate.

### Is CreateCertificateFromCsr more secure than CreateKeysAndCertificate?

Yes. With CreateCertificateFromCsr the device generates its private key and sends only a CSR, so the key never leaves the device. With CreateKeysAndCertificate AWS IoT generates the key and returns it to the device in the MQTT response, so it exists outside the device and crosses the network.

### What is the difference between just-in-time provisioning and fleet provisioning?

JITP is for devices that already carry a certificate signed by your own CA: AWS registers and provisions that certificate the first time the device connects. Fleet provisioning is for devices without a certificate: they connect with a claim certificate and AWS issues them a new certificate signed by the Amazon Root CA.

### What happens if someone extracts the claim certificate from a device?

They can request certificates and register new things under your provisioning template, because the claim is identical in every device. A pre-provisioning hook that checks serial numbers limits this. Deactivating the claim certificate stops future registrations but does not affect devices already provisioned.

### Do I need a secure element to provision certificates securely?

No. What matters most is that the device generates its own private key and sends only a CSR. A secure element or a cellular modem with internal key generation also stops the key being read out of the chip, which raises the bar further, but a microcontroller that generates and stores its own key already avoids shared device identities.

### Can I move device certificates between IoT platforms?

Certificates signed by your own CA can be trusted by any broker you register that CA with. Certificates issued by a platform's CA, such as the Amazon Root CA in fleet provisioning or Paqett's device CA, are trusted by that platform's broker. With device-generated keys, moving platform means enrolling again with a new CSR; nothing secret has to be exported.

## Related

- [Provisioning API](/devices/provisioning)
- [ESP32 MQTT over mutual TLS with an X.509 client certificate](/guides/esp32-mqtt-mutual-tls-x509)
- [Generate a CSR on an ESP32 with mbedTLS](/guides/esp32-generate-csr-mbedtls)
- [How MQTT mutual TLS works](/learn/mqtt-mutual-tls)

## Sources

- [AWS IoT Core: Device provisioning](https://docs.aws.amazon.com/iot/latest/developerguide/iot-provision.html): the three fleet scenarios, claim certificates shared across a fleet, deactivation not blocking provisioned devices, the five-minute trusted-user claim
- [AWS IoT Core: Provisioning devices that don't have device certificates using fleet provisioning](https://docs.aws.amazon.com/iot/latest/developerguide/provision-wo-cert.html): claim policy, provisioning role, CreateProvisioningClaim, one-hour ownership token, pre-provisioning hooks
- [AWS IoT Core: Device provisioning MQTT API](https://docs.aws.amazon.com/iot/latest/developerguide/fleet-provision-api.html): CreateKeysAndCertificate returns `privateKey`; CreateCertificateFromCsr takes a PEM CSR; RegisterThing topics and payloads
- [AWS IoT Core: Just-in-time provisioning](https://docs.aws.amazon.com/iot/latest/developerguide/jit-provisioning.html): CA-attached templates, parameters from the certificate subject, SNI requirement
- [AWS IoT Core: Just-in-time registration](https://docs.aws.amazon.com/iot/latest/developerguide/auto-register-device-cert.html): automatic registration, `PENDING_ACTIVATION`, the registration event topic and the recommended activation Lambda
- [RFC 2986: PKCS #10 Certification Request Syntax](https://www.rfc-editor.org/rfc/rfc2986): the CSR format, which carries the public key and a signature by the private key
