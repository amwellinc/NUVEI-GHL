#!/bin/sh
set -e

# Railway mounts the persistent volume (GHL OAuth token storage — see
# src/services/ghlTokenStore.js) as root-owned by default, but the app
# itself runs as the unprivileged "nodejs" user for security. This runs as
# root (before su-exec drops privileges below) purely to fix ownership of
# the mount point so the app can actually write to it.
if [ -d /data ]; then
  chown -R nodejs:nodejs /data
fi

exec su-exec nodejs "$@"
