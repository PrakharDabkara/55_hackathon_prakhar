# PostGIS image plus pgvector. Versions are pinned; bump them together.
FROM postgis/postgis:18-3.6

ARG PGVECTOR_VERSION=0.8.7-1.pgdg13+1

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-18-pgvector=${PGVECTOR_VERSION} \
  && rm -rf /var/lib/apt/lists/*
