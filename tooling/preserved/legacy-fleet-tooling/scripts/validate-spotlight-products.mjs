#!/usr/bin/env node

import { main } from './sync-spotlight-products.mjs';

process.exit(await main(process.argv.slice(2)));
