#!/bin/bash

# Run the BullMQ worker with tsx and memory limit
cd /home/sei/Github/openalex-count
exec tsx --max-old-space-size=256 app/actions/worker.ts
