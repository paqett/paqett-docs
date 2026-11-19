import { LISTED, SECTIONS } from '$lib/content';
import { SITE } from '$lib/schema';

export const prerender = true;

// https://llmstxt.org: a plain index of the docs for language models and answer engines.
// Each entry links the page's Markdown twin, which is what the spec recommends.
export function GET() {
	const lines = [
		'# Paqett docs',
		'',
		'> Developer documentation for Paqett, a London-based platform for connected sensors. IP devices (ESP32 on Wi-Fi now) make their own EC P-256 key, enrol with a project API key for an X.509 client certificate (POST https://api.paqett.com/v1/devices/provision), talk MQTT over mutual TLS to mqtt.paqett.com:8883 under devices/<device id>/, and take OTA firmware updates offered over that MQTT session, with SHA-256 checks and bootloader rollback.',
		'',
		'Key facts:',
		'',
		'- The device generates its private key; the key never leaves the chip and the platform stores no device secret.',
		'- Certificates are EC P-256, valid 5 years, common name = device id; the broker maps the CN to the MQTT username and client id and allows only devices/<id>/#.',
		'- Re-provisioning is pinned to the device key (a different key gets 409 until the certificates are revoked); revocation is enforced by the broker on every connect and fails closed.',
		'- OTA: a retained offer on devices/<id>/ota with a signed one-hour HTTPS URL, size and SHA-256; the device boots the image on trial and confirms it only after MQTT is up and its hello is sent.',
		`- Everything as one file: ${SITE}/llms-full.txt`,
		'',
		...SECTIONS.flatMap((s) => [
			`## ${s.label}`,
			'',
			...LISTED.filter((d) => d.section === s.id).map(
				(d) => `- [${d.title}](${SITE}${d.path}.md): ${d.tldr || d.description}`
			),
			''
		]),
		'## Optional',
		'',
		'- [Paqett](https://www.paqett.com/): what Paqett is and who it is for',
		'- [Field notes](https://www.paqett.com/writing): articles on monitoring, radios and pricing',
		''
	];
	return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
