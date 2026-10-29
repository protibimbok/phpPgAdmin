import { defineConfig } from 'vitepress'

const repo = 'https://github.com/protibimbok/phpPgAdmin'

export default defineConfig({
  title: 'phpPgAdmin',
  description: 'PostgreSQL administration in the browser, with the phpMyAdmin interface.',
  lang: 'en-US',
  // Served from https://protibimbok.github.io/phpPgAdmin/; DOCS_BASE overrides it for a custom domain.
  base: process.env.DOCS_BASE ?? '/phpPgAdmin/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['demo/**', 'scripts/**'],
  head: [
    ['link', { rel: 'icon', href: `${process.env.DOCS_BASE ?? '/phpPgAdmin/'}logo.svg`, type: 'image/svg+xml' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/master/docs/:path`, text: 'Edit this page on GitHub' },
    outline: { level: [2, 3] },
    footer: { message: 'Released under the MIT License.' },

    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'Using phpPgAdmin', link: '/server/databases', activeMatch: '/(server|database|schema|table|tools)/' },
      { text: 'Developers', link: '/developers/architecture', activeMatch: '/developers/' },
      { text: 'Releases', link: `${repo}/releases` },
    ],

    sidebar: {
      '/developers/': [
        {
          text: 'Developers',
          items: [
            { text: 'Architecture', link: '/developers/architecture' },
            { text: 'Building from source', link: '/developers/building' },
            { text: 'Writing a module', link: '/developers/modules' },
            { text: 'SQL templates and nodes', link: '/developers/nodes' },
            { text: 'Frontend', link: '/developers/frontend' },
            { text: 'Translations', link: '/developers/translations' },
          ],
        },
      ],
      '/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Signing in', link: '/guide/signing-in' },
            { text: 'Finding your way around', link: '/guide/interface' },
            { text: 'Known limitations', link: '/guide/limitations' },
          ],
        },
        {
          text: 'Server',
          collapsed: false,
          items: [
            { text: 'Databases', link: '/server/databases' },
            { text: 'Status and monitoring', link: '/server/status' },
            { text: 'Server logs', link: '/server/logs' },
            { text: 'Roles', link: '/server/roles' },
            { text: 'Tablespaces', link: '/server/tablespaces' },
            { text: 'Replication', link: '/server/replication' },
            { text: 'Variables', link: '/server/variables' },
            { text: 'Settings', link: '/server/settings' },
          ],
        },
        {
          text: 'Database',
          collapsed: false,
          items: [
            { text: 'Schemas', link: '/database/schemas' },
            { text: 'Database operations', link: '/database/operations' },
            { text: 'Search', link: '/database/search' },
            { text: 'Extensions and other objects', link: '/database/objects' },
            { text: 'Foreign data', link: '/database/foreign-data' },
            { text: 'Designer', link: '/database/designer' },
            { text: 'Schema diff', link: '/database/schema-diff' },
          ],
        },
        {
          text: 'Schema',
          collapsed: false,
          items: [
            { text: 'Tables in a schema', link: '/schema/structure' },
            { text: 'Creating a table', link: '/schema/create-table' },
            { text: 'Views and materialized views', link: '/schema/views' },
            { text: 'Functions and procedures', link: '/schema/routines' },
            { text: 'Sequences', link: '/schema/sequences' },
            { text: 'Types, domains and collations', link: '/schema/types' },
            { text: 'Full text search', link: '/schema/text-search' },
            { text: 'Schema operations', link: '/schema/operations' },
          ],
        },
        {
          text: 'Table',
          collapsed: false,
          items: [
            { text: 'Browsing data', link: '/table/browse' },
            { text: 'Inserting and editing rows', link: '/table/insert' },
            { text: 'Searching a table', link: '/table/search' },
            { text: 'Structure: columns', link: '/table/structure' },
            { text: 'Indexes and constraints', link: '/table/indexes-constraints' },
            { text: 'Partitions and inheritance', link: '/table/partitions' },
            { text: 'Triggers, rules and policies', link: '/table/triggers' },
            { text: 'Table operations', link: '/table/operations' },
          ],
        },
        {
          text: 'Tools',
          collapsed: false,
          items: [
            { text: 'SQL editor', link: '/tools/sql' },
            { text: 'History, bookmarks and macros', link: '/tools/history-bookmarks' },
            { text: 'Console', link: '/tools/console' },
            { text: 'Privileges', link: '/tools/privileges' },
            { text: 'Export', link: '/tools/export' },
            { text: 'Import', link: '/tools/import' },
            { text: 'Maintenance', link: '/tools/maintenance' },
            { text: 'Debugger', link: '/tools/debugger' },
          ],
        },
      ],
    },
  },
})
