# smart-type-expander

A lightweight, zero-dependency CLI tool built on top of the native TypeScript Compiler API. It recursively expands deeply nested, truncated TypeScript types into fully structural representations while safely protecting native objects, class instances, and ORM schemas from breaking into internal prototype definitions.

## Features

- Deep Recursive Expansion: Breaks open nested object shapes, intersections, and unions.
- Smart Auto-Detection: Automatically shields native globals (Date, RegExp, Promise, Map, Set), third-party class instances (Decimal, BigNumber), and database schemas (Zod, Prisma $Enums) from expanding into raw internal prototypes.
- Prettier-Style Formatting: Auto-aligns brackets and outputs clean, 2-space indented definitions row-by-row.
- Config Inheritance: Dynamically locates and reads your project's nearest tsconfig.json to accurately resolve absolute paths, baseUrl, and external dependencies.

## Installation

You do not need to install it locally. Run it on-demand inside any repository using npx:

```bash
npx smart-type-expander <path-to-file> <type-name>
```
