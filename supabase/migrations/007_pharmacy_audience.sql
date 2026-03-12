alter table public.pharmacy_product_catalog
  add column if not exists audience text not null default 'employee'
  check (audience in ('employee', 'doctor'));

update public.pharmacy_product_catalog
set audience = 'employee'
where audience is null;

create index if not exists pharmacy_product_catalog_audience_idx
  on public.pharmacy_product_catalog (audience);
