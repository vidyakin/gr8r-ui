-- UUID v7 (RFC 9562): 48 бит unix-времени в мс + случайные биты, версия 7. Сортируется по времени создания.
-- В PostgreSQL 16 нативной uuidv7() нет (появилась в 18), поэтому функция на чистом SQL без расширений.
-- Используется как DEFAULT для первичных ключей; в коде (сиды, заранее известные id) — uuidv7() из @gr8r/db.
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                FROM 1 FOR 6),
        52, 1),
      53, 1),
    'hex')::uuid
$$;
