#!/usr/bin/env bash
# exit on error
set -o errexit

# Install dependencies using npm (uses package-lock.json for speed)
npm install

# Any other build steps would go here
# e.g., npm run build
