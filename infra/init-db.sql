-- Evolution uses POSTGRES_DB=evolution (created automatically).
-- Our CRM/backend owns a separate database so schemas never mix.
CREATE DATABASE platform;
GRANT ALL PRIVILEGES ON DATABASE platform TO evolution;
