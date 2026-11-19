import { LISTED, SECTIONS } from '$lib/content';
import { SITE } from '$lib/Seo.svelte';

export const prerender = true;

// https://llmstxt.org: a plain index of the docs for language models and answer engines.
export function GET() {
	const lines = [
		'# Paqett docs',
		'',
		'> Developer documentation for Paqett, a platform for connected sensors. IP devices (ESP32 on WiFi now) make their own EC P-256 key, enrol with a project API key for an X.509 client certificate (POST https://api.paqett.com/v1/devices/provision), talk MQTT over mutual TLS to mqtt.paqett.com:8883 under devices/<device id>/, and take OTA firmware updates offered over that MQTT session.',
		'',
		...SECTIONS.flatMap((s) => [
			`## ${s.label}`,
			'',
			...LISTED.filter((d) => d.section === s.id).map((d) => `- [${d.title}](${SITE}${d.path}): ${d.description}`),
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
