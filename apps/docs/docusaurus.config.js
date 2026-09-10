export default {
  title: 'NHS-SIM handbook',
  tagline: 'Build against a synthetic care system',
  url: process.env.PUBLIC_ORIGIN || 'http://localhost:8080',
  baseUrl: '/docs/',
  trailingSlash: true,
  onBrokenLinks: 'throw',
  markdown: { format: 'detect' },
  presets: [['classic', {
    docs: { path: 'content', routeBasePath: '/', sidebarPath: false },
    blog: false,
    pages: false,
    theme: { customCss: './src/css/custom.css' },
  }]],
  themeConfig: {
    colorMode: { defaultMode: 'light', disableSwitch: true },
    navbar: {
      title: 'NHS-SIM / Handbook',
      items: [
        { to: '/quickstart/', label: 'Start', position: 'right' },
        { to: '/ten-year-plan/', label: 'Explore the plan', position: 'right' },
        { to: '/api/', label: 'API', position: 'right' },
        { href: 'pathname:///docs/explorer/', autoAddBaseUrl: false, label: 'API explorer', position: 'right' },
        { to: '/data/', label: 'Data', position: 'right' },
        { href: 'pathname:///control/', autoAddBaseUrl: false, label: 'Open simulator ↗', position: 'right' },
      ],
    },
    footer: { copyright: 'NHS-SIM · Fictional people, local services, observable workflows.' },
  },
};
