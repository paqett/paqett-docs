import { LISTED, SECTIONS } from '$lib/content';
import { SITE } from '$lib/Seo.svelte';

export const prerender = true;

export function GET() {
	const newest = LISTED.map((d) => d.updated).sort().at(-1) ?? '';
	const urls = [
		{ loc: `${SITE}/`, lastmod: newest },
		...SECTIONS.map((s) => ({
			loc: `${SITE}/${s.id}`,
			lastmod: LISTED.filter((d) => d.section === s.id).map((d) => d.updated).sort().at(-1) ?? newest
		})),
		...LISTED.map((d) => ({ loc: SITE + d.path, lastmod: d.updated }))
	];
	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
	return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
