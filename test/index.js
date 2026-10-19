/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* Lets 'node --test test/' work on Node 22+, where the directory is run as a module (index.js). Node 20 (end of life) scans the folder
   instead, so it also runs run.mjs and this file: use Node 22 or newer. */
import('./lib.test.mjs');
import('./bg.test.mjs');
import('./attribution.test.mjs');
