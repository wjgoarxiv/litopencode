#!/usr/bin/env node
"use strict";

import("../dist/cli.js")
  .then(({ main }) => main())
  .catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
