#!/bin/bash

# Check if the .dev.vars file exists
if [[ ! -f ".dev.vars" ]]; then
  echo ".dev.vars file not found!"
  exit 1
fi

# Loop through each line in the .dev.vars file
while IFS='=' read -r key value; do
  # Check if line is non-empty and not a comment
  if [[ -n "$key" && "$key" != \#* ]]; then
    echo "Setting secret $key"
    
    # Use Wrangler to set the secret for the development environment
    echo "$value" | wrangler secret put "$key"
    
    if [[ $? -eq 0 ]]; then
      echo "Successfully set $key"
    else
      echo "Failed to set $key"
    fi
  fi
done < .dev.vars
