#!/usr/bin/env node
require('./server').run(process.argv[2] || 8888, process.argv[3]).catch(() => {});
