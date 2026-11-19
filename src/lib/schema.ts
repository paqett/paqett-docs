// schema.org JSON-LD for docs pages. One builder per type; [slug]/+page.svelte picks the ones
// a page qualifies for (FAQPage when it has a FAQ, HowTo when it has "Step N:" sections,
// DefinedTermSet when it is the glossary).
import { ENTITIES, sectionLabel, type Doc } from './content';

export const SITE = 'https://docs.paqett.com';

export const ORGANISATION = {
	'@type': 'Organization',
	'@id': 'https://www.paqett.com/#organization',
	name: 'Paqett',
	url: 'https://www.paqett.com/',
	logo: { '@type': 'ImageObject', url: `${SITE}/logo.png`, width: 512, height: 512 },
	description:
		'Paqett designs and builds connected sensors and runs the connectivity and cloud behind them. Based in London, UK.',
	parentOrganization: { '@type': 'Organization', name: 'Grespi Technology Limited', url: 'https://grespi.tech' },
	sameAs: ['https://github.com/paqett', 'https://www.paqett.com/']
};

export const AUTHOR = {
	'@type': 'Person',
	'@id': 'https://www.alessio.london/#person',
	name: 'Alessio Grespi',
	url: 'https://www.alessio.london/',
	jobTitle: 'Founder, Paqett',
	worksFor: { '@id': 'https://www.paqett.com/#organization' },
	knowsAbout: ['Embedded systems', 'IoT device security', 'MQTT', 'X.509 certificates', 'ESP32', 'Hardware design'],
	sameAs: ['https://www.linkedin.com/in/alessio-grespi/', 'https://github.com/AlessioGrespi']
};

const entity = (k: string) => ({ '@type': 'Thing', name: ENTITIES[k].name, sameAs: ENTITIES[k].sameAs });

export function techArticle(doc: Doc, image: string) {
	return {
		'@context': 'https://schema.org',
		'@type': 'TechArticle',
		'@id': `${SITE}${doc.path}#article`,
		headline: doc.title,
		name: doc.title,
		description: doc.description,
		abstract: doc.tldr || undefined,
		url: SITE + doc.path,
		mainEntityOfPage: SITE + doc.path,
		image,
		datePublished: doc.updated,
		dateModified: doc.updated,
		inLanguage: 'en-GB',
		isAccessibleForFree: true,
		wordCount: doc.wordCount || undefined,
		keywords: doc.keywords.join(', ') || undefined,
		articleSection: sectionLabel(doc.section),
		proficiencyLevel: doc.section === 'learn' ? 'Beginner' : 'Expert',
		dependencies: doc.about.includes('esp32') ? 'ESP-IDF 5.x or Arduino-ESP32 3.x' : undefined,
		about: doc.about.slice(0, 3).map(entity),
		mentions: doc.about.slice(3).map(entity),
		citation: doc.sources.map((s) => ({ '@type': 'CreativeWork', name: s.name, url: s.url })),
		author: AUTHOR,
		publisher: ORGANISATION,
		isPartOf: { '@type': 'WebSite', '@id': `${SITE}/#website`, name: 'Paqett docs', url: `${SITE}/` },
		speakable: {
			'@type': 'SpeakableSpecification',
			cssSelector: ['.doc-head h1', '.tldr']
		}
	};
}

export function faqPage(doc: Doc) {
	return {
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		'@id': `${SITE}${doc.path}#faq`,
		mainEntity: doc.faq.map((f) => ({
			'@type': 'Question',
			name: f.q,
			acceptedAnswer: { '@type': 'Answer', text: f.a }
		}))
	};
}

export function howTo(doc: Doc, image: string) {
	return {
		'@context': 'https://schema.org',
		'@type': 'HowTo',
		'@id': `${SITE}${doc.path}#howto`,
		name: doc.title,
		description: doc.tldr || doc.description,
		image,
		inLanguage: 'en-GB',
		tool: doc.about.includes('esp32')
			? [{ '@type': 'HowToTool', name: 'ESP32 development board' }, { '@type': 'HowToTool', name: 'ESP-IDF 5.x or Arduino-ESP32 3.x' }]
			: undefined,
		step: doc.steps.map((s, i) => ({
			'@type': 'HowToStep',
			position: i + 1,
			name: s.name,
			text: s.text,
			url: `${SITE}${doc.path}#${s.id}`
		}))
	};
}

export function definedTermSet(doc: Doc) {
	const setId = `${SITE}${doc.path}#terms`;
	return {
		'@context': 'https://schema.org',
		'@type': 'DefinedTermSet',
		'@id': setId,
		name: doc.title,
		url: SITE + doc.path,
		hasDefinedTerm: doc.terms.map((t) => ({
			'@type': 'DefinedTerm',
			name: t.name,
			description: t.text,
			url: `${SITE}${doc.path}#${t.id}`,
			inDefinedTermSet: setId
		}))
	};
}

/** Every JSON-LD block for a docs page. */
export function docSchema(doc: Doc, image: string) {
	const blocks: Record<string, unknown>[] = [techArticle(doc, image)];
	if (doc.faq.length) blocks.push(faqPage(doc));
	if (doc.steps.length >= 2) blocks.push(howTo(doc, image));
	if (doc.kind === 'glossary' && doc.terms.length) blocks.push(definedTermSet(doc));
	return blocks;
}
