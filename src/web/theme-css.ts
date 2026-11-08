import type { AtRule, Plugin, Rule } from 'postcss';

/**
 * The stylesheets write their light colours once, under `@media (prefers-color-scheme: light)`. This PostCSS step makes a
 * choice in Profil (`data-theme` on <html>) win over the system: inside the media block the rules skip a forced dark page,
 * and a copy outside the block applies to a forced light page.
 */
const LIGHT = /prefers-color-scheme:\s*light/;

// :where() keeps each rule's specificity as it was, so the light rules win and lose exactly where they did before.
const scoped = (selector: string, attr: string): string => selector.split(',').map((s) => {
  const t = s.trim();
  return t.startsWith(':root') ? `:root:where(${attr})${t.slice(':root'.length)}` : `:where(:root${attr}) ${t}`;
}).join(', ');

export function themeChoice(): Plugin {
  return {
    postcssPlugin: 'pandafit-theme-choice',
    Once(css) {
      css.walkAtRules('media', (media: AtRule) => {
        if (!LIGHT.test(media.params)) return;
        if (!/^\(prefers-color-scheme:\s*light\)$/.test(media.params.trim())) throw new Error(`theme choice: combine prefers-color-scheme with nothing else (${media.params})`);
        const forced: Rule[] = [];
        media.walkRules((rule: Rule) => {
          const copy = rule.clone({ selector: scoped(rule.selector, '[data-theme="light"]') });
          forced.push(copy);
          rule.selector = scoped(rule.selector, ':not([data-theme="dark"])');
        });
        media.after(forced);
      });
    },
  };
}
themeChoice.postcss = true;
