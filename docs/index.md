---
layout: home

hero:
  name: phpPgAdmin
  text: PostgreSQL administration in the browser
  tagline: pgAdmin's depth of PostgreSQL support, in the phpMyAdmin interface you already know. PHP and ext-pgsql, no agent, no desktop install.
  image:
    src: /logo.svg
    alt: phpPgAdmin
  actions:
    - theme: brand
      text: Get started
      link: /guide/introduction
    - theme: alt
      text: Install
      link: /guide/installation
    - theme: alt
      text: GitHub
      link: https://github.com/protibimbok/phpPgAdmin

features:
  - icon: 🗂️
    title: Every PostgreSQL object
    details: Databases, schemas, tables, partitions, views, materialized views, functions, procedures, sequences, types, domains, collations, text search, extensions, foreign data and more. Create, alter and drop each one, and see the DDL first.
    link: /schema/structure
  - icon: ⌨️
    title: SQL editor and data grid
    details: Autocomplete, formatting, bind parameters, history, bookmarks and macros. Results open in an editable grid with paging, sorting, filters and inline editing.
    link: /tools/sql
  - icon: 📈
    title: Server monitoring
    details: Live charts, sessions with cancel and terminate, locks, prepared transactions, server logs, replication and configuration, all from the server's own views.
    link: /server/status
  - icon: 🔐
    title: Roles and privileges
    details: Roles, memberships, object and column privileges, default privileges and a grant wizard.
    link: /server/roles
  - icon: 📦
    title: Export, import, maintenance
    details: pg_dump and pg_dumpall downloads, CSV through COPY, restores that run in the background, and VACUUM, ANALYZE, REINDEX and CLUSTER.
    link: /tools/export
  - icon: 🧭
    title: Designer, schema diff, debugger
    details: An ER diagram editor, a schema comparison that writes the migration script, and a PL/pgSQL debugger.
    link: /database/designer
---
