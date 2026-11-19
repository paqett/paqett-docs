import { LISTED, SECTIONS, markdownFor } from '$lib/content';
import { SITE } from '$lib/schema';

export const prerender = true;

// Every page's Markdown in one file, in reading order (https://llmstxt.org, llms-full.txt).
export function GET() {
	const parts = [
		'# Paqett docs (full text)',
		'',
		`> Every page of ${SITE} as Markdown. Paqett connects IP devices (ESP32 on Wi-Fi now) with device-generated X.509 certificates, MQTT over mutual TLS at mqtt.paqett.com:8883, and OTA firmware updates over that session. Author: Alessio Grespi, Paqett (London, UK).`,
		''
	];
	for (const s of SECTIONS) {
		for (const d of LISTED.filter((x) => x.section === s.id)) {
			parts.push('---', '', markdownFor(d, SITE));
		}
	}
	return new Response(parts.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
