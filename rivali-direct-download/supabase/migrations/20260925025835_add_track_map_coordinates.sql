-- Coordinates allow one saved track record to anchor the satellite map,
-- weather lookup, start/finish line, and preferred-groove data.
alter table public.tracks
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

comment on column public.tracks.latitude is 'Latitude for the saved satellite-map track location.';
comment on column public.tracks.longitude is 'Longitude for the saved satellite-map track location.';
