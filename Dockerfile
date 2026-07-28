FROM node:22-alpine

WORKDIR /app

# Static site with zero npm dependencies -- copy everything the server needs.
COPY . .

# Run as non-root.
RUN addgroup -S harmonic && adduser -S harmonic -G harmonic
USER harmonic

ENV PORT=8080
EXPOSE 8080

# SUPABASE_URL and SUPABASE_ANON_KEY must be supplied at `docker run` time
# (see .env.example). The container starts without them, but /api/config
# will return 503 until both are set -- this is intentional, not a bug.
CMD ["node", "server.js"]
