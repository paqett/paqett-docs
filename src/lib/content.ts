// Every docs page is a Markdown file at src/content/<section>/<slug>.md, served at
// /<section>/<slug>. Its frontmatter: title, description (the meta description,
// 140 to 160 characters), order (within the section), updated (YYYY-MM-DD), keywords,
// and optionally nav (a shorter sidebar label) and draft (true = built, noindex, unlisted).
// svelte.config.js adds headings and wordCount.

export type Heading = { depth: 2 | 3; text: string; id: string };

export type Doc = {
	section: SectionId;
	slug: string;
	path: string;
	title: string;
	nav: string;
	description: string;
	order: number;
	updated: string;
	keywords: string[];
	headings: Heading[];
	wordCount: number;
	draft: boolean;
};

export const SECTIONS = [
	{ id: 'guides', label: 'Guides', blurb: 'Step by step, from a bare board to a working device.' },
	{ id: 'devices', label: 'Device reference', blurb: 'The contract between a device and the platform.' }
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

const raw = import.meta.glob<Record<string, unknown>>('/src/content/*/*.md', {
	eager: true,
	import: 'metadata'
});

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
			order: Number(m.order ?? 99),
			// YAML reads an unquoted 2026-11-19 as a Date, which mdsvex serialises to an ISO string.
			updated: (m.updated instanceof Date ? m.updated.toISOString() : String(m.updated)).slice(0, 10),
			keywords: (m.keywords as string[]) ?? [],
			headings: (m.headings as Heading[]) ?? [],
			wordCount: Number(m.wordCount ?? 0),
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
