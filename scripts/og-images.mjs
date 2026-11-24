// Share images: static/og/<slug>.png (1200x630) for every page, rendered by headless Chrome
// from a small HTML card. Run `pnpm og` after adding or retitling a page, and commit the PNGs.
//
//   CHROME=/path/to/chrome pnpm og      (defaults to Google Chrome on macOS)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = new URL('..', import.meta.url).pathname;
const outDir = join(root, 'static/og');
const work = join(tmpdir(), `paqett-docs-og-${process.pid}`);
mkdirSync(outDir, { recursive: true });
mkdirSync(work, { recursive: true });

const wordmark = readFileSync(join(root, 'src/lib/assets/paqett-wordmark.svg'), 'utf8');
const SECTION = { guides: 'Guide', learn: 'Concepts', devices: 'Device reference' };

/** The quoted or plain value of `key:` in a Markdown file's frontmatter. */
function front(src, key) {
	const m = src.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
	return m ? m[1].trim().replace(/^"(.*)"$/, '$1') : '';
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const pages = [
	{ slug: 'home', kicker: 'Paqett docs', title: 'Connect a device. Keep it updated.' },
	{ slug: 'guides', kicker: 'Paqett docs', title: 'Guides: ESP32 MQTT, mutual TLS, device shadow and OTA' },
	{ slug: 'devices', kicker: 'Paqett docs', title: 'Device reference: provisioning, MQTT topics, control protocol and OTA' },
	{ slug: 'learn', kicker: 'Paqett docs', title: 'Concepts: MQTT mutual TLS, device certificates and provisioning' }
];
for (const section of Object.keys(SECTION)) {
	for (const file of readdirSync(join(root, 'src/content', section))) {
		if (!file.endsWith('.md')) continue;
		const src = readFileSync(join(root, 'src/content', section, file), 'utf8');
		pages.push({
			slug: `${section}--${file.replace(/\.md$/, '')}`,
			kicker: SECTION[section],
			title: front(src, 'title')
		});
	}
}

for (const p of pages) {
	const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=Space+Grotesk:wght@600&display=block" rel="stylesheet">
<style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{box-sizing:border-box;padding:72px 80px;display:flex;flex-direction:column;background:#fff;color:#343330;font-family:'Space Grotesk',sans-serif;
background-image:radial-gradient(#e7e5e0 1.5px,transparent 1.5px);background-size:28px 28px;background-position:14px 14px}
.top{display:flex;align-items:center;gap:20px}.top svg{width:150px;height:auto}
.tag{font:500 20px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:#8800ff;background:#f4ebff;padding:6px 12px;border-radius:6px}
h1{margin:auto 0 0;font-size:${p.title.length > 60 ? 60 : 70}px;line-height:1.08;letter-spacing:-.02em;font-weight:600;max-width:1000px}
.foot{margin-top:36px;font:500 22px 'IBM Plex Mono',monospace;color:#6b6964}
.bar{position:absolute;left:0;bottom:0;width:1200px;height:12px;background:#8800ff}
</style></head><body>
<div class="top">${wordmark}<span class="tag">${esc(p.kicker)}</span></div>
<h1>${esc(p.title)}</h1>
<div class="foot">docs.paqett.com</div><div class="bar"></div>
</body></html>`;
	const htmlPath = join(work, `${p.slug}.html`);
	writeFileSync(htmlPath, html);
	execFileSync(CHROME, [
		'--headless=new',
		'--disable-gpu',
		'--hide-scrollbars',
		'--virtual-time-budget=4000',
		'--window-size=1200,630',
		`--screenshot=${join(outDir, `${p.slug}.png`)}`,
		`file://${htmlPath}`
	], { stdio: 'ignore' });
	console.log(`og/${p.slug}.png`);
}
rmSync(work, { recursive: true, force: true });
