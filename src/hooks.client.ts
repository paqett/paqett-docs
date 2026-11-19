import posthog from 'posthog-js';

// PostHog project "paqett.com" (EU cloud), shared with www.paqett.com: the docs are part of
// the same journey, and the org has no free project slot. Filter on $host to split them.
// Project keys are public by design.
const POSTHOG_KEY = 'phc_reoboSK9F35h9QZERsFJfe9XHqKmFaigr5ZwvwNoScem';
const PRODUCTION_HOST = 'docs.paqett.com';

// The owner's own browsers: open any page once with ?internal=1 (?internal=0 undoes it).
// The flag lives only in that browser's localStorage; nothing is written for other visitors.
// Their events carry is_internal, which the PostHog project's internal-user filter hides.
function isInternalBrowser(): boolean {
	try {
		const flag = new URLSearchParams(location.search).get('internal');
		if (flag === '1') localStorage.setItem('ph_internal', '1');
		if (flag === '0') localStorage.removeItem('ph_internal');
		return localStorage.getItem('ph_internal') === '1';
	} catch {
		return false; // storage blocked: treat as a normal visitor
	}
}

// Only the production host reports, so localhost and Vercel previews stay out of the numbers.
if (location.hostname === PRODUCTION_HOST) {
	const internal = isInternalBrowser();
	posthog.init(POSTHOG_KEY, {
		// Reverse-proxied through vercel.json so ad-blockers don't drop events.
		api_host: '/ph',
		ui_host: 'https://eu.posthog.com',
		// No cookies or local storage: visitors are counted with a daily server-side hash
		// (cookieless server hash mode is on for the project).
		cookieless_mode: 'always',
		capture_pageview: 'history_change',
		capture_pageleave: true,
		person_profiles: 'identified_only',
		before_send: (event) => {
			if (event && internal) event.properties.is_internal = true;
			return event;
		}
	});
}
