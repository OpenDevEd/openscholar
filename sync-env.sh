#!/bin/bash

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "Error: .env.local file not found!"
    exit 1
fi

echo "Syncing environment variables from .env.local to Convex..."

# Read .env.local line by line
while IFS='=' read -r key value || [ -n "$key" ]; do
    # Skip comments and empty lines
    [[ $key =~ ^#.*$ ]] && continue
    [[ -z $key ]] && continue

    # Remove quotes from value if present
    value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")

    # Skip internal Convex keys that shouldn't be pushed
    if [[ $key == "CONVEX_SELF_HOSTED_URL" ]] || \
       [[ $key == "CONVEX_SELF_HOSTED_ADMIN_KEY" ]] || \
       [[ $key == "NEXT_PUBLIC_CONVEX_URL" ]]; then
        continue
    fi

    # Set the variable in Convex
    echo "Setting $key..."
    npx convex env set "$key" "$value"
    
done < .env.local

echo "Done! Environment variables synced."
