import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const DEFAULT_TITLE = 'Chesslyze | Chess Performance Intelligence Platform';
const DEFAULT_DESCRIPTION = 'Chesslyze unifies your Lichess, Chess.com, and PGN games to reveal long-term patterns, identify personal weaknesses, and turn your chess history into targeted training and measurable progress.';

const ROUTE_META = {
    '/': {
        title: 'Performance | Chesslyze',
        description: 'Review your games with chess performance intelligence: engine analysis, move insights, personal patterns, and measurable progress from your own chess history.'
    },
    '/library': {
        title: 'Game Archive | Chesslyze',
        description: 'Search and review your complete cross-platform chess game archive from Lichess, Chess.com, and PGN imports.'
    },
    '/reels': {
        title: 'Training Feed | Chesslyze',
        description: 'Train with personalized chess drills and puzzle moments generated from mistakes, tactics, and opportunities in your own games.'
    },
    '/openings': {
        title: 'Opening Intelligence | Chesslyze',
        description: 'Analyze opening performance, repertoire patterns, common mistakes, and best games across your personal chess history.'
    },
    '/profile': {
        title: 'Progress | Chesslyze',
        description: 'Track chess rating progress, peak ratings, win rates, accuracy, openings, and long-term performance trends across platforms.'
    },
    '/import': {
        title: 'Connect Games | Chesslyze',
        description: 'Connect Lichess, Chess.com, or PGN games to build your personal chess performance profile and training workspace.'
    },
    '/settings': {
        title: 'Settings | Chesslyze',
        description: 'Manage chess profiles, engine settings, board preferences, and local-first data controls in Chesslyze.'
    }
};

const setMeta = (name, content, attr = 'name') => {
    if (!content) return;
    let element = document.head.querySelector(`meta[${attr}="${name}"]`);
    if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attr, name);
        document.head.appendChild(element);
    }
    element.setAttribute('content', content);
};

const setCanonical = (href) => {
    let element = document.head.querySelector('link[rel="canonical"]');
    if (!element) {
        element = document.createElement('link');
        element.setAttribute('rel', 'canonical');
        document.head.appendChild(element);
    }
    element.setAttribute('href', href);
};

export const SEO = () => {
    const location = useLocation();

    useEffect(() => {
        const meta = ROUTE_META[location.pathname] || {
            title: DEFAULT_TITLE,
            description: DEFAULT_DESCRIPTION
        };
        const canonical = `${window.location.origin}${location.pathname || '/'}`;

        document.title = meta.title;
        setMeta('description', meta.description);
        setMeta('robots', 'index,follow');
        setMeta('og:title', meta.title, 'property');
        setMeta('og:description', meta.description, 'property');
        setMeta('og:url', canonical, 'property');
        setMeta('twitter:title', meta.title);
        setMeta('twitter:description', meta.description);
        setCanonical(canonical);
    }, [location.pathname]);

    return null;
};
