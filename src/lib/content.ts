// Every docs page is a Markdown file at src/content/<section>/<slug>.md, served at
// /<section>/<slug> (and its Markdown twin at /<section>/<slug>.md). Frontmatter:
// title, description (the meta description, 140 to 160 characters), tldr (a 40 to 60 word
// direct answer, shown at the top and used as the abstract), order (within the section),
// updated (YYYY-MM-DD), keywords, about (entity keys, see ENTITIES), and optionally nav (a
// shorter sidebar label), kind ('glossary' = DefinedTermSet) and draft (true = built,
// noindex, unlisted). svelte.config.js adds headings, wordCount, faq, steps, terms, sources.

export type Heading = { depth: 2 | 3; text: string; id: string };
export type Faq = { q: string; a: string };
export type Step = { name: string; text: string; id: string };
export type Term = { name: string; text: string; id: string };
export type Source = { url: string; name: string };

export type Doc = {
	section: SectionId;
	slug: string;
	path: string;
	title: string;
	nav: string;
	description: string;
	tldr: string;
	order: number;
	updated: string;
	keywords: string[];
	about: string[];
	kind: string;
	headings: Heading[];
	wordCount: number;
	faq: Faq[];
	steps: Step[];
	terms: Term[];
	sources: Source[];
	draft: boolean;
};

export const SECTIONS = [
	{ id: 'guides', label: 'Guides', blurb: 'Step by step, from a bare board to a working device.' },
	{
		id: 'learn',
		label: 'Concepts',
		blurb: 'How device identity, mutual TLS and provisioning work, and how the options compare.'
	},
	{ id: 'devices', label: 'Device reference', blurb: 'The contract between a device and the platform.' }
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * Entities a page can be `about`, for schema.org about/mentions. sameAs points at the
 * Wikipedia article, which is what search engines and LLMs resolve entities against.
 */
export const ENTITIES: Record<string, { name: string; sameAs: string }> = {
	esp32: { name: 'ESP32', sameAs: 'https://en.wikipedia.org/wiki/ESP32' },
	'esp-idf': { name: 'ESP-IDF', sameAs: 'https://en.wikipedia.org/wiki/ESP32' },
	arduino: { name: 'Arduino', sameAs: 'https://en.wikipedia.org/wiki/Arduino' },
	mqtt: { name: 'MQTT', sameAs: 'https://en.wikipedia.org/wiki/MQTT' },
	x509: { name: 'X.509', sameAs: 'https://en.wikipedia.org/wiki/X.509' },
	tls: { name: 'Transport Layer Security', sameAs: 'https://en.wikipedia.org/wiki/Transport_Layer_Security' },
	mtls: { name: 'Mutual TLS', sameAs: 'https://en.wikipedia.org/wiki/Mutual_authentication' },
	mbedtls: { name: 'Mbed TLS', sameAs: 'https://en.wikipedia.org/wiki/Mbed_TLS' },
	csr: {
		name: 'Certificate signing request',
		sameAs: 'https://en.wikipedia.org/wiki/Certificate_signing_request'
	},
	pki: { name: 'Public key infrastructure', sameAs: 'https://en.wikipedia.org/wiki/Public_key_infrastructure' },
	ecc: { name: 'Elliptic-curve cryptography', sameAs: 'https://en.wikipedia.org/wiki/Elliptic-curve_cryptography' },
	ota: { name: 'Over-the-air update', sameAs: 'https://en.wikipedia.org/wiki/Over-the-air_update' },
	'aws-iot': { name: 'AWS IoT Core', sameAs: 'https://en.wikipedia.org/wiki/Amazon_Web_Services' },
	nvs: { name: 'Non-volatile storage', sameAs: 'https://en.wikipedia.org/wiki/Non-volatile_memory' }
};

const raw = import.meta.glob<Record<string, unknown>>('/src/content/*/*.md', {
	eager: true,
	import: 'metadata'
});

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const DOCS: Doc[] = Object.entries(raw)
	.map(([file, m]) => {
		const [, , , section, name] = file.split('/');
		const slug = name.replace(/\.md$/, '');
		return {
			section: section as SectionId,
			slug,
			path: `/${section}/${slug}`,
			title: String(m.title),
			nav: String(m.nav ?? m.title),
			description: String(m.description),
			tldr: String(m.tldr ?? ''),
			order: Number(m.order ?? 99),
			// YAML reads an unquoted 2026-11-19 as a Date, which mdsvex serialises to an ISO string.
			updated: (m.updated instanceof Date ? m.updated.toISOString() : String(m.updated)).slice(0, 10),
			keywords: list<string>(m.keywords),
			about: list<string>(m.about).filter((k) => k in ENTITIES),
			kind: String(m.kind ?? ''),
			headings: list<Heading>(m.headings),
			wordCount: Number(m.wordCount ?? 0),
			faq: list<Faq>(m.faq),
			steps: list<Step>(m.steps),
			terms: list<Term>(m.terms),
			sources: list<Source>(m.sources),
			draft: m.draft === true
		};
	})
	.filter((d) => SECTIONS.some((s) => s.id === d.section))
	.sort(
		(a, b) =>
			SECTIONS.findIndex((s) => s.id === a.section) - SECTIONS.findIndex((s) => s.id === b.section) ||
			a.order - b.order
	);

/** Pages listed in the sidebar, sitemap and llms.txt. */
export const LISTED = DOCS.filter((d) => !d.draft);

export function docFor(section: string, slug: string): Doc | undefined {
	return DOCS.find((d) => d.section === section && d.slug === slug);
}

export function sectionLabel(id: string): string {
	return SECTIONS.find((s) => s.id === id)?.label ?? id;
}

/** The pages either side of this one in reading order, for the footer links. */
export function neighbours(doc: Doc): { prev?: Doc; next?: Doc } {
	const i = LISTED.findIndex((d) => d.path === doc.path);
	if (i < 0) return {};
	return { prev: LISTED[i - 1], next: LISTED[i + 1] };
}

/** Pages that share the most `about` entities with this one, for the "Related" block. */
export function related(doc: Doc, n = 4): Doc[] {
	return LISTED.filter((d) => d.path !== doc.path)
		.map((d) => ({ d, score: d.about.filter((a) => doc.about.includes(a)).length }))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score || a.d.order - b.d.order)
		.slice(0, n)
		.map((x) => x.d);
}

const bodies = import.meta.glob<string>('/src/content/*/*.md', {
	eager: true,
	query: '?raw',
	import: 'default'
});

/**
 * A page as plain Markdown for LLMs (the /<section>/<slug>.md twin and llms-full.txt):
 * title, canonical URL, summary, then the body without frontmatter.
 */
export function markdownFor(doc: Doc, site: string): string {
	const src = bodies[`/src/content/${doc.section}/${doc.slug}.md`] ?? '';
	const body = src.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
	return [
		`# ${doc.title}`,
		'',
		`Source: ${site}${doc.path}`,
		`Updated: ${doc.updated}`,
		'',
		`> ${doc.tldr || doc.description}`,
		'',
		body,
		''
	].join('\n');
}
